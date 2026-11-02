"""SalesCast AI: generate demo sales, evaluate chronological forecasts, export reproducible fixtures."""
from pathlib import Path
import json, csv, sys
from datetime import date,timedelta
import numpy as np
from sklearn.linear_model import Ridge
import sklearn

ROOT=Path(__file__).resolve().parents[1]
ALPHA=3.0
CATALOG=[
 {'product':'Moringa Capsules','sku':'MC-001','price':129,'base':32,'trend':.018,'phase':.1,'stock':820,'lead':14,'safety':7},
 {'product':'Hibiscus Tea','sku':'HT-002','price':79,'base':24,'trend':.012,'phase':1.1,'stock':270,'lead':10,'safety':7},
 {'product':'Spirulina Powder','sku':'SP-003','price':169,'base':18,'trend':.008,'phase':2.2,'stock':700,'lead':14,'safety':7},
 {'product':'Baobab Blend','sku':'BB-004','price':99,'base':21,'trend':.016,'phase':.7,'stock':430,'lead':12,'safety':7},
 {'product':'Ginger Tonic','sku':'GT-005','price':65,'base':35,'trend':.025,'phase':1.8,'stock':610,'lead':10,'safety':7},
 {'product':'Herbal Starter Kit','sku':'HK-006','price':249,'base':11,'trend':.007,'phase':2.7,'stock':500,'lead':14,'safety':7}
]

def generate():
    rng=np.random.default_rng(20261102)
    start=date(2024,11,2);rows=[]
    for j,p in enumerate(CATALOG):
        for i in range(730):
            d=start+timedelta(days=i)
            weekday=[-.08,-.05,0,.01,.16,.23,-.14][d.weekday()]
            seasonal=.17*np.sin(2*np.pi*i/365.25+p['phase'])+.055*np.cos(4*np.pi*i/365.25)
            mean=p['base']*(1+weekday+seasonal)+p['trend']*i
            noise=rng.normal(0,2.0+p['base']*.07)
            # Infrequent unsignalled promotions create realistic, unmodelled shocks.
            if i%67==j*3:noise+=p['base']*.6
            rows.append({'date':d.isoformat(),'product':p['product'],'units':max(0,int(round(mean+noise))),'unit_price':p['price']})
    path=ROOT/'dist/data';path.mkdir(parents=True,exist_ok=True)
    with (path/'demo_sales.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['date','product','units','unit_price']);w.writeheader();w.writerows(rows)
    (path/'catalog.json').write_text(json.dumps(CATALOG,indent=2))
    return rows

def features(days,start,annual):
    days=np.asarray(days,dtype=float);phase=2*np.pi*days/365.25;weekday=(days.astype(int)+4)%7
    cols=[(days-start)/365]+[(weekday==i).astype(float) for i in range(1,7)]
    cols += [f(phase*m) if annual else np.zeros(len(days)) for m in [1,2] for f in [np.sin,np.cos]]
    return np.column_stack(cols)

def ridge_fit(days,units,start,annual):
    return Ridge(alpha=ALPHA,fit_intercept=True,solver='svd').fit(features(days,start,annual),units)

def ridge_predict(model,days,start,annual):return np.maximum(0,model.predict(features(days,start,annual)))
def weekly(units,n):return np.resize(np.asarray(units[-7:],dtype=float),n)
def metrics(actual,pred):
    a=np.asarray(actual);p=np.asarray(pred);errors=np.abs(a-p)
    return {'mae':float(errors.mean()),'wape':float(errors.sum()/a.sum()) if a.sum() else None,'rmse':float(np.sqrt(np.mean((a-p)**2))),'absoluteError':float(errors.sum()),'totalActual':float(a.sum())}

def train(rows):
    epoch=date(1970,1,1);products=[];fixtures=[]
    for p in CATALOG:
        records=[r for r in rows if r['product']==p['product']]
        days=np.array([(date.fromisoformat(r['date'])-epoch).days for r in records]);units=np.array([r['units'] for r in records],dtype=float)
        start=int(days[0]);n=len(units);annual=n-84>=365;val={'ridge':[],'weekly':[]}
        for cut in [n-84,n-56]:
            model=ridge_fit(days[:cut],units[:cut],start,annual)
            val['ridge'].extend(np.abs(units[cut:cut+28]-ridge_predict(model,days[cut:cut+28],start,annual)).tolist())
            val['weekly'].extend(np.abs(units[cut:cut+28]-weekly(units[:cut],28)).tolist())
        chosen='ridge' if sum(val['ridge'])<sum(val['weekly']) else 'weekly'
        cut=n-28;model=ridge_fit(days[:cut],units[:cut],start,annual)
        rp=ridge_predict(model,days[cut:],start,annual);wp=weekly(units[:cut],28);pred=rp if chosen=='ridge' else wp
        radius=float(np.quantile(val[chosen],.8,method='higher'))
        final=ridge_fit(days,units,start,annual);future_days=np.arange(days[-1]+1,days[-1]+181)
        forecast=ridge_predict(final,future_days,start,annual) if chosen=='ridge' else weekly(units,180)
        item={'product':p['product'],'selected':chosen,'annual':annual,'test':metrics(units[cut:],pred),'ridge_test':metrics(units[cut:],rp),'weekly_test':metrics(units[cut:],wp),'range_radius':radius,'test_coverage':float((np.abs(units[cut:]-pred)<=radius).mean()),'training_rows':n,'validation_days':56,'test_days':28}
        products.append(item)
        fixtures.append({'product':p['product'],'selected':chosen,'beta':[float(final.intercept_),*final.coef_.tolist()],'forecast_first_30':forecast[:30].tolist(),'radius':radius,'test_wape':item['test']['wape'],'test_predictions':pred.tolist()})
    actual=sum(p['test']['totalActual'] for p in products);error=sum(p['test']['absoluteError'] for p in products)
    report={'data_source':'Synthetic demonstration only','seed':20261102,'observations':len(rows),'products':products,'portfolio_test_wape':error/actual,'test_days':28,'validation_days':56,'alpha':ALPHA,'python':sys.version.split()[0],'numpy':np.__version__,'scikit_learn':sklearn.__version__}
    (ROOT/'project/evaluation.json').write_text(json.dumps(report,indent=2))
    (ROOT/'project/python_fixtures.json').write_text(json.dumps(fixtures,indent=2))
    print(json.dumps({'rows':len(rows),'products':len(products),'held_out_wape':report['portfolio_test_wape'],'models':{p['product']:p['selected'] for p in products}},indent=2))
    return report

def main():
    (ROOT/'project').mkdir(exist_ok=True)
    return train(generate())

if __name__=='__main__':main()

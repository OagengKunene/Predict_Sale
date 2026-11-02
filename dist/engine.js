// Calendar Ridge regression, chronological evaluation, and strict daily-series import.
export const DAY = 86400000, ALPHA = 3;
export const MODEL_NAMES = {ridge:'Calendar regression',weekly:'Weekly baseline',auto:'Auto-select'};
export const iso = day => new Date(day * DAY).toISOString().slice(0,10);
export function parseDay(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error(`Date “${value}” must use YYYY-MM-DD.`);
  const time=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)throw new Error(`Invalid date “${value}”.`);
  return time/DAY;
}
export function csvRows(text) {
  text=text.replace(/^\uFEFF/,'');
  const delimiter=(text.split(/\r?\n/,1)[0].match(/;/g)||[]).length>(text.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':',';
  const result=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else if(!quoted&&field.trim()){throw new Error('A quote appeared inside an unquoted CSV field.');}
      else quoted=!quoted;
    }else if(c===delimiter&&!quoted){row.push(field.trim());field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field.trim());if(row.some(v=>v!==''))result.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('The CSV has an unclosed quoted field.');
  row.push(field.trim());if(row.some(v=>v!==''))result.push(row);
  return result;
}
export function parseCSV(text) {
  if(text.length>8000000)throw new Error('Use a CSV smaller than 8 MB.');
  const rows=csvRows(text);if(rows.length<2)throw new Error('The CSV needs a header and sales records.');
  const header=rows.shift().map(h=>h.toLowerCase().trim());
  if(new Set(header).size!==header.length)throw new Error('CSV column names must be unique.');
  for(const key of ['date','product','units'])if(!header.includes(key))throw new Error(`Missing required column: ${key}.`);
  if(rows.length>30000)throw new Error('This browser workspace supports up to 30,000 rows.');
  const index=Object.fromEntries(header.map((h,i)=>[h,i])),groups=new Map();let duplicates=0;
  rows.forEach((row,i)=>{
    if(row.length!==header.length)throw new Error(`Record ${i+2} has ${row.length} fields; expected ${header.length}.`);
    const product=row[index.product]?.trim();if(!product||product.length>100)throw new Error(`Record ${i+2}: product must be between 1 and 100 characters.`);
    const day=parseDay(row[index.date]),raw=row[index.units];
    if(raw===''||!Number.isFinite(Number(raw))||Number(raw)<0)throw new Error(`Record ${i+2}: units must be a non-negative number.`);
    const units=Number(raw);let price=null;
    if(index.unit_price!==undefined&&row[index.unit_price]!==''){
      price=Number(row[index.unit_price]);if(!Number.isFinite(price)||price<0)throw new Error(`Record ${i+2}: unit_price must be a non-negative number or blank.`);
    }
    if(!groups.has(product))groups.set(product,new Map());
    const group=groups.get(product),existing=group.get(day);
    if(existing){duplicates++;existing.units+=units;existing.revenue+=units*(price??0);existing.priceComplete&&=price!==null||units===0;if(price!==null)existing.lastPrice=price;}
    else group.set(day,{day,units,revenue:units*(price??0),priceComplete:price!==null||units===0,lastPrice:price});
  });
  if(groups.size>50)throw new Error('Use up to 50 products per dataset.');
  const series=[...groups].map(([product,records],i)=>{
    const points=[...records.values()].sort((a,b)=>a.day-b.day);
    if(points.length<140)throw new Error(`“${product}” has ${points.length} daily observations. At least 140 are required (56 initial training + 56 validation + 28 test days).`);
    for(let j=1;j<points.length;j++)if(points[j].day!==points[j-1].day+1)throw new Error(`“${product}” is missing ${iso(points[j-1].day+1)}. Add zero only if you know there were no sales; missing days are not filled automatically.`);
    const lastPriced=[...points].reverse().find(p=>p.lastPrice!==null);
    return {id:`product-${i+1}`,product,start:points[0].day,end:points.at(-1).day,days:points.map(p=>p.day),units:points.map(p=>p.units),revenue:points.map(p=>p.priceComplete?p.revenue:null),unitPrice:lastPriced?.lastPrice??null,priceDate:lastPriced?iso(lastPriced.day):null};
  });
  if(new Set(series.map(s=>s.end)).size!==1)throw new Error('All products must end on the same date. Align the last recorded day for each product.');
  return {series,summary:{rows:rows.length,products:series.length,duplicates,start:Math.min(...series.map(s=>s.start)),end:series[0].end,commonStart:Math.max(...series.map(s=>s.start))}};
}
export function features(day,start,annual) {
  const weekday=((day+4)%7+7)%7,phase=2*Math.PI*day/365.25;
  return [1,(day-start)/365,...Array.from({length:6},(_,i)=>weekday===i+1?1:0),annual?Math.sin(phase):0,annual?Math.cos(phase):0,annual?Math.sin(2*phase):0,annual?Math.cos(2*phase):0];
}
function solve(a,b) {
  const n=b.length,m=a.map((row,i)=>[...row,b[i]]);
  for(let k=0;k<n;k++){
    let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[pivot][k]))pivot=i;
    [m[k],m[pivot]]=[m[pivot],m[k]];
    if(Math.abs(m[k][k])<1e-12)throw new Error('Model fitting failed: the feature system is singular.');
    const value=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=value;
    for(let i=0;i<n;i++)if(i!==k){const f=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=f*m[k][j];}
  }
  return m.map(row=>row[n]);
}
export function fitRidge(days,units,start,annual) {
  const n=12,a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
  for(let i=0;i<days.length;i++){const x=features(days[i],start,annual);for(let j=0;j<n;j++){b[j]+=x[j]*units[i];for(let k=0;k<n;k++)a[j][k]+=x[j]*x[k];}}
  for(let j=1;j<n;j++)a[j][j]+=ALPHA;
  return solve(a,b);
}
export function ridgePredict(beta,days,start,annual) {return days.map(day=>Math.max(0,features(day,start,annual).reduce((sum,x,i)=>sum+x*beta[i],0)));}
export function weeklyPredict(units,n) {const last=units.slice(-7);return Array.from({length:n},(_,i)=>last[i%7]);}
const absErrors=(actual,pred)=>actual.map((v,i)=>Math.abs(v-pred[i]));
const sum=a=>a.reduce((s,v)=>s+v,0);
export function score(actual,predicted) {
  const absolute=absErrors(actual,predicted),total=sum(actual);
  return {mae:sum(absolute)/actual.length,rmse:Math.sqrt(sum(actual.map((y,i)=>(y-predicted[i])**2))/actual.length),wape:total?sum(absolute)/total:null,totalActual:total,absoluteError:sum(absolute)};
}
export function forecastSeries(series,method='auto') {
  const n=series.units.length,annual=n-84>=365,val={ridge:[],weekly:[]};
  for(const cut of [n-84,n-56]){
    const days=series.days.slice(0,cut),units=series.units.slice(0,cut),target=series.units.slice(cut,cut+28),future=series.days.slice(cut,cut+28);
    const beta=fitRidge(days,units,series.start,annual);
    val.ridge.push(...absErrors(target,ridgePredict(beta,future,series.start,annual)));
    val.weekly.push(...absErrors(target,weeklyPredict(units,28)));
  }
  const auto=sum(val.ridge)<sum(val.weekly)?'ridge':'weekly',selected=method==='auto'?auto:method;
  if(!['ridge','weekly'].includes(selected))throw new Error('Unknown forecasting method.');
  const cut=n-28,trainDays=series.days.slice(0,cut),trainUnits=series.units.slice(0,cut),testDays=series.days.slice(cut),actual=series.units.slice(cut);
  const betaTest=fitRidge(trainDays,trainUnits,series.start,annual),ridge=ridgePredict(betaTest,testDays,series.start,annual),weekly=weeklyPredict(trainUnits,28),predicted=selected==='ridge'?ridge:weekly;
  const errors=[...val[selected]].sort((a,b)=>a-b),radius=errors[Math.ceil((errors.length-1)*.8)];
  const beta=fitRidge(series.days,series.units,series.start,annual),futureDays=Array.from({length:180},(_,i)=>series.end+i+1),future=selected==='ridge'?ridgePredict(beta,futureDays,series.start,annual):weeklyPredict(series.units,180);
  return {...series,selected,auto,annual,beta,validation:{ridgeMAE:sum(val.ridge)/56,weeklyMAE:sum(val.weekly)/56,days:56},test:{days:testDays,actual,predicted,ridge,weekly,metrics:score(actual,predicted),ridgeMetrics:score(actual,ridge),weeklyMetrics:score(actual,weekly),coverage:absErrors(actual,predicted).filter(e=>e<=radius).length/28},radius,forecast:future.map((units,i)=>({day:futureDays[i],units,lower:Math.max(0,units-radius),upper:units+radius}))};
}
export function buildForecast(dataset,method='auto') {return {products:dataset.series.map(s=>forecastSeries(s,method)),summary:dataset.summary,method};}
export function portfolio(products,horizon) {
  const last=products[0].end,common=Math.max(...products.map(p=>p.start)),start=Math.max(common,last-89);
  const actual=Array.from({length:last-start+1},(_,i)=>{const day=start+i;return {day,units:sum(products.map(p=>p.units[day-p.start]))};});
  const future=Array.from({length:horizon},(_,i)=>({day:last+i+1,units:sum(products.map(p=>p.forecast[i].units)),lower:sum(products.map(p=>p.forecast[i].lower)),upper:sum(products.map(p=>p.forecast[i].upper))}));
  const test=products[0].test.days.map((day,i)=>({day,actual:sum(products.map(p=>p.test.actual[i])),predicted:sum(products.map(p=>p.test.predicted[i]))}));
  const demand=sum(future.map(p=>p.units)),prior=sum(products.flatMap(p=>p.units.slice(-horizon))),actualTotal=sum(products.map(p=>p.test.metrics.totalActual)),absoluteError=sum(products.map(p=>p.test.metrics.absoluteError));
  const pricesAvailable=products.every(p=>p.unitPrice!==null),historyPriceComplete=products.every(p=>p.revenue.slice(-30).every(v=>v!==null));
  return {actual,future,test,demand,prior,growth:prior?demand/prior-1:null,wape:actualTotal?absoluteError/actualTotal:null,mae:absoluteError/(products.length*28),historicalRevenue:historyPriceComplete?sum(products.flatMap(p=>p.revenue.slice(-30))):null,forecastRevenue:pricesAvailable?sum(products.map(p=>sum(p.forecast.slice(0,horizon).map(f=>f.units))*p.unitPrice)):null};
}
export function planInventory(product,settings,horizon) {
  const stock=settings?.stock,lead=Math.max(1,Math.min(90,Math.round(settings?.lead??14))),safety=Math.max(0,Math.min(30,Math.round(settings?.safety??7)));
  if(stock===null||stock===undefined||stock===''||!Number.isFinite(Number(stock))||Number(stock)<0)return {action:'setup',stock:null,lead,safety,quantity:null,stockout:null,target:null};
  const leadDemand=sum(product.forecast.slice(0,lead).map(p=>p.units)),target=sum(product.forecast.slice(0,lead+safety).map(p=>p.units));
  let cumulative=0,stockout=null;
  for(const point of product.forecast.slice(0,horizon)){cumulative+=point.units;if(cumulative>Number(stock)){stockout=point.day;break;}}
  const quantity=Math.ceil(Math.max(0,target-Number(stock))),action=Number(stock)<leadDemand?'urgent':quantity>0?'reorder':'covered';
  return {stock:Number(stock),lead,safety,target,leadDemand,quantity,stockout,action};
}
export function forecastCSV(products,horizon,currency='ZAR') {
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[['date','product','forecast_units','planning_lower','planning_upper','model','unit_price','currency']];
  for(const p of products)for(const point of p.forecast.slice(0,horizon))rows.push([iso(point.day),p.product,point.units.toFixed(3),point.lower.toFixed(3),point.upper.toFixed(3),p.selected,p.unitPrice??'',p.unitPrice===null?'':currency]);
  return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
}

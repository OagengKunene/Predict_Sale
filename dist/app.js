import {parseCSV,portfolio,planInventory,forecastCSV,iso,MODEL_NAMES} from './engine.js';
const $=id=>document.getElementById(id),sum=a=>a.reduce((s,v)=>s+v,0);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(n,digits=0)=>Number.isFinite(n)?new Intl.NumberFormat('en-ZA',{maximumFractionDigits:digits}).format(n):'—';
const percentage=(n,digits=1)=>Number.isFinite(n)?`${(n*100).toFixed(digits)}%`:'—';
const dateLabel=(day,opts={day:'2-digit',month:'short',year:'numeric'})=>new Intl.DateTimeFormat('en-GB',{...opts,timeZone:'UTC'}).format(new Date(day*86400000));
let dataset=null,result=null,catalog=[],source='demo',sourceName='Synthetic demonstration data',demoCSV='',job=0,busy=false,chartMode='forecast',toastTimer;
let inventory={},savedStock={};
try{const parsed=JSON.parse(localStorage.getItem('salescast-stock-v1')||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))savedStock=parsed;}catch{}
const worker=new Worker('./worker.js',{type:'module'});
const horizon=()=>Number($('horizon-select').value);
const currency=()=>$('currency-select').value;
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('en-ZA',{style:'currency',currency:currency(),maximumFractionDigits:0}).format(n):'—';
const selectedProducts=()=>!result?[]:$('product-select').value==='all'?result.products:result.products.filter(p=>p.id===$('product-select').value);
const sku=p=>catalog.find(c=>c.product===p.product)?.sku||`SKU-${p.id.split('-')[1].padStart(3,'0')}`;
const avatar=(p,i)=>`<span class="product-avatar color-${i%6}">${escape(p.product.split(/\s+/).map(s=>s[0]).slice(0,2).join(''))}</span>`;
const productName=(p,i)=>`<div class="product-name">${avatar(p,i)}<div><strong>${escape(p.product)}</strong><small>${escape(sku(p))}</small></div></div>`;
const actionNames={urgent:'Order now',reorder:'Reorder soon',covered:'Stock covered',setup:'Add stock'};
const badge=action=>`<span class="badge ${action}">${action==='covered'?'<svg><use href="#i-check"/></svg>':''}${actionNames[action]}</span>`;

function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
function error(message,title='Unable to import data'){$('error-title').textContent=title;$('error-message').textContent=message;$('app-error').hidden=false;window.scrollTo({top:0,behavior:'smooth'});}
$('dismiss-error').addEventListener('click',()=>$('app-error').hidden=true);
function showView(view){
  if(!['overview','inventory','models','data','guide'].includes(view))view='overview';
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);
  document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===view;el.classList.toggle('active',active);active?el.setAttribute('aria-current','page'):el.removeAttribute('aria-current');});
  $('breadcrumb-view').textContent={overview:'Forecast overview',inventory:'Inventory planner',models:'Model performance',data:'Data workspace',guide:'Project guide'}[view];
  if(location.hash!==`#${view}`)window.history.replaceState(null,'',`#${view}`);
  if(view==='overview'&&result)drawChart();
}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.view)));
document.querySelectorAll('[data-open]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.open)));
window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
document.querySelectorAll('[data-upload]').forEach(el=>el.addEventListener('click',()=>$('csv-file').click()));

function setBusy(value){busy=value;$('run-forecast').disabled=value;$('export-forecast').disabled=value||!result;$('method-select').disabled=value;$('engine-status').classList.toggle('is-busy',value);$('engine-status').innerHTML=`<i></i>${value?'Fitting & evaluating':'Forecast ready'}`;$('run-forecast').innerHTML=`<svg><use href="#i-${value?'refresh':'spark'}"/></svg><span>${value?'Training models…':'Run forecast'}</span>`;}
function initialiseStock(){inventory={};for(const p of dataset.series){const key=`${source}:${p.product}`,demo=catalog.find(c=>c.product===p.product),saved=savedStock[key];inventory[p.id]={stock:source==='demo'?demo?.stock??null:null,lead:source==='demo'?demo?.lead??14:14,safety:7};if(saved&&typeof saved==='object'){for(const field of ['stock','lead','safety']){const v=saved[field];if(v===null&&field==='stock')inventory[p.id][field]=null;else if(Number.isFinite(v)&&v>=0&&(field==='stock'||field==='lead'&&v>=1&&v<=90||field==='safety'&&v<=30))inventory[p.id][field]=v;}}}}
function runForecast(){if(!dataset)return;setBusy(true);worker.postMessage({id:++job,dataset,method:$('method-select').value});}
worker.onmessage=event=>{if(event.data.id!==job)return;if(!event.data.ok){setBusy(false);error(event.data.message,'Forecast could not be fitted');return;}result=event.data.result;setBusy(false);renderAll();};
worker.onerror=()=>{setBusy(false);error('The forecasting worker could not start. Reload the page in a modern browser.','Forecast engine unavailable');};
function applyDataset(parsed,isDemo,name){dataset=parsed;source=isDemo?'demo':'custom';sourceName=name;result=null;initialiseStock();$('app-error').hidden=true;const select=$('product-select');select.replaceChildren(new Option('All products','all'),...dataset.series.map(p=>new Option(p.product,p.id)));runForecast();}
async function useDemo(){try{if(!demoCSV){const [sales,products]=await Promise.all([fetch('./data/demo_sales.csv'),fetch('./data/catalog.json')]);if(!sales.ok||!products.ok)throw new Error('Demo files could not be loaded.');demoCSV=await sales.text();catalog=await products.json();}applyDataset(parseCSV(demoCSV),true,'Synthetic demonstration data');}catch(e){error(e.message,'Unable to load the demo');setBusy(false);}}
async function importFile(file){if(!file)return;try{if(file.size>8000000)throw new Error('Use a CSV smaller than 8 MB.');const parsed=parseCSV(await file.text());applyDataset(parsed,false,file.name);toast(`Imported ${number(parsed.summary.rows)} sales rows. Fitting your forecasts…`);}catch(e){error(e.message);}finally{$('csv-file').value='';}}
$('csv-file').addEventListener('change',e=>importFile(e.target.files[0]));
$('use-demo').addEventListener('click',()=>{useDemo();toast('Demo data restored. Saved stock settings are retained.');});
$('run-forecast').addEventListener('click',runForecast);
$('method-select').addEventListener('change',runForecast);
$('product-select').addEventListener('change',()=>{if(result)renderDashboard();});
$('horizon-select').addEventListener('change',()=>{if(result){renderDashboard();renderInventory();}});
$('currency-select').addEventListener('change',()=>{if(result){renderDashboard();renderInventory();renderData();}toast('Currency label updated. Values have not been converted.');});
for(const type of ['dragenter','dragover'])$('drop-zone').addEventListener(type,e=>{e.preventDefault();$('drop-zone').classList.add('drag-over');});
for(const type of ['dragleave','drop'])$('drop-zone').addEventListener(type,e=>{e.preventDefault();$('drop-zone').classList.remove('drag-over');if(type==='drop')importFile(e.dataTransfer.files[0]);});
function renderAll(){renderDashboard();renderInventory();renderModels();renderData();}
function renderDashboard(){
  const products=selectedProducts();if(!products.length)return;const h=horizon(),data=portfolio(products,h),plans=products.map(p=>({product:p,...planInventory(p,inventory[p.id],h)})),risk=plans.filter(p=>p.action==='urgent'||p.action==='reorder');
  $('source-tag').innerHTML=`<i></i>${source==='demo'?'SYNTHETIC DEMO DATA':'YOUR UPLOADED DATA'}`;$('source-tag').classList.toggle('custom',source!=='demo');
  $('data-through').textContent=`Data through ${dateLabel(result.summary.end)}`;
  $('dataset-caption').textContent=`${result.products.length} products · ${number(result.summary.rows)} sales rows`;
  $('metric-revenue').textContent=money(data.historicalRevenue);$('revenue-caption').textContent=data.historicalRevenue===null?'Add unit_price for revenue estimates':'Observed units × recorded prices';
  $('metric-units').textContent=number(data.demand);$('units-period').textContent=`NEXT ${h} DAYS`;
  $('demand-caption').textContent=data.growth===null?'Compared with the previous matching period':`${data.growth>=0?'↗':'↘'} ${percentage(Math.abs(data.growth))} vs previous ${h} days`;
  $('metric-wape').textContent=percentage(data.wape);$('metric-risk').textContent=plans.every(p=>p.action==='setup')?'—':String(risk.length);
  $('risk-caption').textContent=plans.every(p=>p.action==='setup')?'Add stock to enable planning':`${risk.length} of ${products.length} products need stock attention`;
  $('snapshot-units').textContent=number(data.demand);$('snapshot-period').textContent=`units in the next ${h} days`;
  $('snapshot-growth').textContent=data.growth===null?'No sales in the comparison window':`${data.growth>=0?'↗':'↘'} ${percentage(Math.abs(data.growth))} ${data.growth>=0?'more':'less'} than the previous ${h} days`;
  $('snapshot-value').textContent=money(data.forecastRevenue);
  const peak=data.future.reduce((best,p)=>p.units>best.units?p:best,data.future[0]);$('snapshot-peak').textContent=`${dateLabel(peak.day,{day:'2-digit',month:'short'})} · ${number(peak.units)} units`;
  $('snapshot-note').textContent=h>28?`${h}-day forecasts extend beyond the evaluated 28-day horizon. Ranges use past errors and do not guarantee future outcomes.`:'Future sales value uses the latest known unit price. Check the plan against promotions, stockouts, and changing prices.';
  $('outlook-period').textContent=`${h}-day demand`;
  $('outlook-body').innerHTML=products.map((p,i)=>{const units=sum(p.forecast.slice(0,h).map(f=>f.units)),plan=planInventory(p,inventory[p.id],h);return `<tr class="outlook-row" tabindex="0" data-product="${p.id}" aria-label="Plan stock for ${escape(p.product)}"><td>${productName(p,i)}</td><td class="number-mono">${number(units)}</td><td class="number-mono">${p.unitPrice===null?'—':money(units*p.unitPrice)}</td><td>${percentage(p.test.metrics.wape)}</td><td>${badge(plan.action)}</td></tr>`;}).join('');
  $('outlook-body').querySelectorAll('tr').forEach(row=>{const activate=()=>{showView('inventory');$(`stock-card-${row.dataset.product}`)?.scrollIntoView({behavior:'smooth',block:'center'});};row.addEventListener('click',activate);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});});
  const signals=plans.filter(p=>p.action!=='covered').sort((a,b)=>(a.action==='urgent'?-1:1)-(b.action==='urgent'?-1:1)).slice(0,3);
  $('planning-signals').innerHTML=signals.length?signals.map(s=>`<div class="signal"><span class="signal-icon"><svg><use href="#i-${s.action==='setup'?'info':'box'}"/></svg></span><div><strong>${escape(s.product.product)}</strong><p>${s.action==='setup'?'Add available stock to calculate an order estimate.':`Order estimate: ${number(s.quantity)} units.${s.stockout?` Stock may run out ${dateLabel(s.stockout,{day:'2-digit',month:'short'})}.`:' Stock covers the forecast window.'}`}</p></div></div>`).join(''):'<div class="signal"><span class="signal-icon"><svg><use href="#i-check"/></svg></span><div><strong>Stock is in step.</strong><p>Available stock covers the lead-time and safety-cover targets for these products.</p></div></div>';
  $('model-caption').textContent=`${products.filter(p=>p.selected==='ridge').length} regression · ${products.filter(p=>p.selected==='weekly').length} weekly baseline`;
  drawChart();
}

function drawChart(){
  const products=selectedProducts();if(!products.length||$('view-overview').hidden)return;
  const h=horizon(),data=portfolio(products,h),backtest=chartMode==='backtest';
  $('chart-title').textContent=backtest?'A forecast put to the test':'Sales & demand forecast';
  $('chart-description').textContent=backtest?'Actual sales vs predictions on the final 28 unseen days':`Daily units · 90 days of context and the next ${h} days`;
  $('prediction-key').textContent=backtest?'Test prediction':'Forecast';
  $('range-note').textContent=products.length>1?'Summed product error bands form a planning envelope, not a confidence interval.':'Range: 80th percentile of past validation errors; future coverage is not guaranteed.';
  const actual=data.actual,predicted=backtest?data.test.map((p,i)=>({day:p.day,units:p.predicted,lower:sum(products.map(q=>Math.max(0,q.test.predicted[i]-q.radius))),upper:sum(products.map(q=>q.test.predicted[i]+q.radius))})):data.future;
  const width=Math.max(380,$('chart-wrap').clientWidth-24),height=width<500?245:278,left=46,right=19,top=31,bottom=38,plotW=width-left-right,plotH=height-top-bottom;
  const first=actual[0].day,last=backtest?actual.at(-1).day:predicted.at(-1).day,maximum=Math.max(...actual.map(p=>p.units),...predicted.map(p=>p.upper),1)*1.12;
  const raw=maximum/4,power=10**Math.floor(Math.log10(raw)),ratio=raw/power,step=(ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power,yMax=Math.ceil(maximum/step)*step;
  const x=day=>left+(day-first)/(last-first)*plotW,y=value=>top+plotH-value/yMax*plotH;
  const path=points=>points.map((p,i)=>`${i?'L':'M'}${x(p.day).toFixed(2)},${y(p.units).toFixed(2)}`).join(' ');
  const upper=predicted.map(p=>({day:p.day,units:p.upper})),lower=predicted.map(p=>({day:p.day,units:p.lower})).reverse();
  const band=path(upper)+' '+lower.map(p=>`L${x(p.day).toFixed(2)},${y(p.units).toFixed(2)}`).join(' ')+' Z';
  const cutoff=backtest?predicted[0].day:actual.at(-1).day,cutX=x(cutoff),forecastLine=backtest?predicted:[actual.at(-1),...predicted];
  let grid='';for(let v=0;v<=yMax+.001;v+=step)grid+=`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="#edf1f7" stroke-dasharray="3 4"/><text x="${left-12}" y="${y(v)+3}" text-anchor="end" fill="#9aabc4" font-size="10">${number(v)}</text>`;
  const ticks=width<500?4:6;let dates='';for(let i=0;i<ticks;i++){const d=Math.round(first+(last-first)*i/(ticks-1));dates+=`<text x="${x(d)}" y="${height-11}" text-anchor="${i===0?'start':i===ticks-1?'end':'middle'}" fill="#9aabc4" font-size="10">${dateLabel(d,{day:'2-digit',month:'short'})}</text>`;}
  $('forecast-chart').classList.remove('chart-placeholder');$('forecast-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" style="aspect-ratio:${width}/${height}" role="img" aria-label="Daily sales and ${backtest?'held-out test predictions':'future demand estimates'} for ${products.length===1?escape(products[0].product):'all products'}. Blue shows actual sales; orange shows predictions and a planning range."><defs><linearGradient id="actual-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#86a2ef" stop-opacity=".10"/><stop offset="100%" stop-color="#86a2ef" stop-opacity="0"/></linearGradient></defs><rect x="${cutX}" y="${top}" width="${width-right-cutX}" height="${plotH}" fill="#fffaf3"/>${grid}<path d="${path(actual)} L${x(actual.at(-1).day)},${y(0)} L${x(first)},${y(0)} Z" fill="url(#actual-fill)"/><path d="${band}" fill="#f4d8b4" opacity=".48"/><path d="${path(actual)}" fill="none" stroke="#7698ee" stroke-width="1.8"/><path d="${path(forecastLine)}" fill="none" stroke="#dca46f" stroke-width="2" ${backtest?'stroke-dasharray="4 3"':''}/><line x1="${cutX}" x2="${cutX}" y1="${top-3}" y2="${top+plotH}" stroke="#e1cbb1" stroke-dasharray="4 4"/><text x="${Math.min(width-120,cutX+7)}" y="${top-12}" fill="#c3a27c" font-size="9">${backtest?'HELD-OUT TEST':'FORECAST BEGINS'}</text><circle cx="${x(actual.at(-1).day)}" cy="${y(actual.at(-1).units)}" r="3" fill="#7899eb" stroke="#fff" stroke-width="2"/>${dates}<line id="hover-line" x1="0" x2="0" y1="${top}" y2="${top+plotH}" stroke="#b9c8e6" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
  const svg=$('forecast-chart').querySelector('svg'),actualMap=new Map(actual.map(p=>[p.day,p])),forecastMap=new Map(predicted.map(p=>[p.day,p]));
  svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect(),logical=(event.clientX-rect.left)/rect.width*width;const day=Math.max(first,Math.min(last,Math.round(first+(logical-left)/plotW*(last-first))));const a=actualMap.get(day),f=forecastMap.get(day);$('chart-tooltip').innerHTML=`<strong>${dateLabel(day)}</strong>${a?`<span>Actual sales <b>${number(a.units,1)}</b></span>`:''}${f?`<span>${backtest?'Test prediction':'Forecast'} <b>${number(f.units,1)}</b></span><span>Planning range <b>${number(f.lower,1)}–${number(f.upper,1)}</b></span>`:''}`;const wrap=$('chart-wrap').getBoundingClientRect();$('chart-tooltip').hidden=false;$('chart-tooltip').style.left=`${Math.min(wrap.width-170,Math.max(9,event.clientX-wrap.left+10))}px`;$('chart-tooltip').style.top=`${Math.max(8,event.clientY-wrap.top-93)}px`;const hover=$('hover-line');hover.setAttribute('x1',x(day));hover.setAttribute('x2',x(day));hover.setAttribute('visibility','visible');});
  svg.addEventListener('pointerleave',()=>{$('chart-tooltip').hidden=true;$('hover-line')?.setAttribute('visibility','hidden');});
}
for(const mode of ['forecast','backtest'])$(`chart-${mode}`).addEventListener('click',()=>{chartMode=mode;for(const m of ['forecast','backtest'])$(`chart-${m}`).classList.toggle('selected',m===mode);drawChart();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(drawChart,100);});

function renderInventory(){
  if(!result)return;const products=result.products,h=horizon(),plans=products.map(p=>({product:p,...planInventory(p,inventory[p.id],h)})),risk=plans.filter(p=>p.action==='urgent'||p.action==='reorder'),covered=plans.filter(p=>p.action==='covered');
  $('inventory-badge').textContent=risk.length;
  $('inventory-summary').innerHTML=`<div><span>Products needing stock</span><strong>${risk.length}</strong><small>${plans.filter(p=>p.action==='setup').length} still need a stock value</small></div><div><span>Estimated order quantity</span><strong>${number(sum(plans.map(p=>p.quantity??0)))}</strong><small>Units to reach stock-cover targets</small></div><div><span>Stock-covered products</span><strong>${covered.length} / ${products.length}</strong><small>Stockout view: next ${h} days</small></div>`;
  $('inventory-grid').innerHTML=plans.map((plan,i)=>{const p=plan.product,cover=plan.stock===null?0:Math.min(100,plan.target>0?plan.stock/plan.target*100:100);return `<article class="panel stock-card" id="stock-card-${p.id}"><div class="stock-card-header">${productName(p,i)}${badge(plan.action)}</div><div class="stock-fields"><label>Available stock<input type="number" min="0" step="any" placeholder="Add stock" value="${plan.stock??''}" data-field="stock" data-product="${p.id}" aria-label="Available stock for ${escape(p.product)}"></label><label>Lead time · days<input type="number" min="1" max="90" step="1" value="${plan.lead}" data-field="lead" data-product="${p.id}" aria-label="Lead time for ${escape(p.product)}"></label><label>Safety · days<input type="number" min="0" max="30" step="1" value="${plan.safety}" data-field="safety" data-product="${p.id}" aria-label="Safety cover for ${escape(p.product)}"></label></div><div class="stock-meter"><span class="${plan.action==='covered'?'covered':''}" style="width:${cover}%"></span></div><div class="stock-meter-caption">${plan.stock===null?'Add stock to calculate coverage.':`${number(cover)}% of the lead-time + safety-cover target`}</div><div class="stock-stat"><span>Target stock cover</span><strong>${plan.target===null?'—':`${number(Math.ceil(plan.target))} units`}</strong></div><div class="stock-stat"><span>Estimated stockout</span><strong>${plan.stock===null?'Add stock':plan.stockout?dateLabel(plan.stockout,{day:'2-digit',month:'short'}):`Beyond ${h} days`}</strong></div><div class="order-recommendation ${plan.action==='covered'?'covered':''}"><span>${plan.action==='setup'?'ORDER ESTIMATE':plan.action==='covered'?'NO ORDER SIGNAL':'ESTIMATED ORDER QUANTITY'}</span><strong>${plan.quantity===null?'—':`${number(plan.quantity)} units`}</strong></div></article>`;}).join('');
}
$('inventory-grid').addEventListener('change',event=>{const input=event.target;if(!input.matches('input[data-field]'))return;if(!input.checkValidity()){input.reportValidity();return;}const p=result.products.find(p=>p.id===input.dataset.product);if(!p)return;const field=input.dataset.field,value=input.value===''?null:Number(input.value);if(value===null&&field!=='stock'){input.value=inventory[p.id][field];return;}inventory[p.id][field]=value;savedStock[`${source}:${p.product}`]={...inventory[p.id]};try{localStorage.setItem('salescast-stock-v1',JSON.stringify(savedStock));}catch{toast('Stock settings apply now, but browser storage is unavailable.');}renderDashboard();renderInventory();});

function renderModels(){
  if(!result)return;const p=result.products,total=sum(p.map(p=>p.test.metrics.totalActual)),selected=sum(p.map(p=>p.test.metrics.absoluteError)),weekly=sum(p.map(p=>p.test.weeklyMetrics.absoluteError)),coverage=sum(p.map(p=>p.test.coverage))/p.length;
  $('evaluation-metrics').innerHTML=`<div><span>Selected forecast · test WAPE</span><strong>${percentage(total?selected/total:null)}</strong><small>Product-level absolute errors, weighted by sales</small></div><div><span>Weekly baseline · test WAPE</span><strong>${percentage(total?weekly/total:null)}</strong><small>${weekly?`${percentage(Math.abs(weekly-selected)/weekly)} ${selected<=weekly?'lower':'higher'} error with the selected models`:'No observed test sales to compare'}</small></div><div><span>Measured range coverage</span><strong>${percentage(coverage)}</strong><small>On held-out days · future coverage can differ</small></div>`;
  const counts=p.map(p=>p.units.length-84);$('train-count').textContent=Math.min(...counts)===Math.max(...counts)?`${counts[0]} days`:`${Math.min(...counts)}–${Math.max(...counts)} days`;
  $('evaluation-body').innerHTML=p.map((p,i)=>`<tr><td>${productName(p,i)}</td><td><span class="badge neutral">${MODEL_NAMES[p.selected]}</span></td><td>${percentage(p.test.ridgeMetrics.wape)}</td><td>${percentage(p.test.weeklyMetrics.wape)}</td><td>${number(p.test.metrics.mae,2)} units</td><td>${percentage(p.test.coverage)}</td></tr>`).join('');
}
function renderData(){
  if(!result)return;const s=result.summary;$('data-source-description').textContent=sourceName;$('data-validity').textContent='Daily series validated';
  $('data-summary').innerHTML=`<div><strong>${number(s.rows)}</strong>CSV records</div><div><strong>${s.products}</strong>Products</div><div><strong>${s.duplicates}</strong>Duplicate rows combined</div><div><strong>${dateLabel(s.end,{day:'2-digit',month:'short'})}</strong>Final observed day</div>`;
  $('data-body').innerHTML=result.products.map((p,i)=>`<tr><td>${productName(p,i)}</td><td>${number(p.units.length)}</td><td>${dateLabel(p.start)}</td><td>${dateLabel(p.end)}</td><td>${money(p.unitPrice)}</td><td>${p.annual?'Weekly + annual':'Weekly only'}</td></tr>`).join('');
}
function download(content,filename,type='text/csv;charset=utf-8'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('export-forecast').addEventListener('click',()=>{if(!result||busy)return;download(forecastCSV(selectedProducts(),horizon(),currency()),'SalesCast_Forecast_Kunene.csv');toast(`Exported ${selectedProducts().length*horizon()} daily forecasts.`);});
$('export-inventory').addEventListener('click',()=>{if(!result)return;const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"',rows=[['product','available_stock','lead_days','safety_days','target_cover_units','estimated_order_units','estimated_stockout','action','forecast_horizon_days']];for(const p of result.products){const s=planInventory(p,inventory[p.id],horizon());rows.push([p.product,s.stock,s.lead,s.safety,s.target?.toFixed(3),s.quantity,s.stockout===null?'':iso(s.stockout),s.action,horizon()]);}download('\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n'),'SalesCast_Stock_Plan_Kunene.csv');toast('Exported the inventory plan.');});

showView(location.hash.slice(1));
await useDemo();

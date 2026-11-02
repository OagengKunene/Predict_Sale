import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCSV,csvRows,buildForecast,forecastSeries,portfolio,planInventory,forecastCSV,iso} from '../dist/engine.js';
const root=new URL('../',import.meta.url),csv=fs.readFileSync(new URL('dist/data/demo_sales.csv',root),'utf8'),fixtures=JSON.parse(fs.readFileSync(new URL('project/python_fixtures.json',root)));
const dataset=parseCSV(csv),result=buildForecast(dataset,'auto');
assert.equal(dataset.summary.rows,4380);assert.equal(dataset.summary.products,6);
let maxForecastDifference=0,maxCoefficientDifference=0;
for(const product of result.products){
  const reference=fixtures.find(f=>f.product===product.product);assert.equal(product.selected,reference.selected);
  product.beta.forEach((v,i)=>{maxCoefficientDifference=Math.max(maxCoefficientDifference,Math.abs(v-reference.beta[i]));});
  product.forecast.slice(0,30).forEach((p,i)=>{maxForecastDifference=Math.max(maxForecastDifference,Math.abs(p.units-reference.forecast_first_30[i]));assert.ok(p.lower>=0&&p.lower<=p.units&&p.units<=p.upper);});
  assert.ok(Math.abs(product.test.metrics.wape-reference.test_wape)<1e-9);
  assert.ok(Math.abs(product.radius-reference.radius)<1e-7);
  product.test.predicted.forEach((v,i)=>assert.ok(Math.abs(v-reference.test_predictions[i])<1e-7));
}
assert.ok(maxForecastDifference<1e-7);assert.ok(maxCoefficientDifference<1e-7);
// Future test targets cannot influence earlier validation or the held-out predictions.
const changed={...dataset.series[0],units:[...dataset.series[0].units]};changed.units.splice(-28,28,...Array(28).fill(1000000));
const changedResult=forecastSeries(changed);assert.equal(changedResult.auto,result.products[0].auto);assert.deepEqual(changedResult.validation,result.products[0].validation);assert.deepEqual(changedResult.test.predicted,result.products[0].test.predicted);
const first=dataset.series[0].start,constantCSV=['date,product,units',...Array.from({length:140},(_,i)=>`${iso(first+i)},Constant,10`)].join('\n');
const constant=buildForecast(parseCSV(constantCSV)).products[0];assert.equal(constant.selected,'weekly');assert.ok(constant.forecast.every(p=>p.units===10));
const plan=planInventory(constant,{stock:150,lead:14,safety:7},30);assert.equal(plan.target,210);assert.equal(plan.quantity,60);assert.equal(plan.stockout,constant.end+16);assert.equal(plan.action,'reorder');
assert.equal(planInventory(constant,{stock:null,lead:14,safety:7},30).action,'setup');
const zero=buildForecast(parseCSV(constantCSV.replaceAll(',10',',0'))).products[0];assert.equal(zero.test.metrics.wape,null);assert.ok(zero.forecast.every(p=>p.units===0));
assert.equal(planInventory(zero,{stock:0,lead:14,safety:7},30).action,'covered');
assert.throws(()=>parseCSV(constantCSV.replace('date,product,units','date,item,units')),/Missing required column/);
assert.throws(()=>parseCSV(constantCSV.replace(',10',',-1')),/non-negative/);
assert.throws(()=>parseCSV((constantCSV+`\n${iso(first+140)},Constant,10`).replace(`${iso(first+30)},Constant,10\n`,'')),/missing/);
assert.throws(()=>parseCSV(constantCSV.replace(iso(first),'2026-02-30')),/Invalid date/);
assert.throws(()=>parseCSV('date,product,units\n2026-01-01,"Unclosed,1'),/unclosed/);
const duplicated=parseCSV(csv+`${iso(dataset.series[0].start)},${dataset.series[0].product},5,129\n`);assert.equal(duplicated.summary.duplicates,1);assert.equal(duplicated.series[0].units[0],dataset.series[0].units[0]+5);
const aggregate=portfolio(result.products,30);assert.ok(Math.abs(aggregate.demand-result.products.reduce((s,p)=>s+p.forecast.slice(0,30).reduce((a,b)=>a+b.units,0),0))<1e-8);
const exported=csvRows(forecastCSV(result.products,30));assert.equal(exported.length,181);assert.ok(exported.every(row=>row.length===8));
console.log(JSON.stringify({passed:true,products_verified:6,forecast_points_compared:180,maxForecastDifference,maxCoefficientDifference,chronological_leakage_check:'passed',csv_validation:'passed',inventory_math:'passed',csv_export_rows:180,demo_test_wape:aggregate.wape},null,2));

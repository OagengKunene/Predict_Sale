import {buildForecast} from './engine.js';
self.onmessage=event=>{try{const {dataset,method,id}=event.data;self.postMessage({ok:true,id,result:buildForecast(dataset,method)});}catch(error){self.postMessage({ok:false,id:event.data.id,message:error.message});}};

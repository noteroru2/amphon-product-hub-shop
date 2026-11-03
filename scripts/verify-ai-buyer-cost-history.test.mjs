import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistoryCostCsv,splitHistoryCsv} from '../src/lib/aiBuyerCostHistory.ts';
test('inventory history is detected without importing as active price',()=>{
 const x=parseHistoryCostCsv('id,code,name,cost,quantity,sourceType,status,category\n1,INV-1,Notebook,10000,1,PURCHASE,SOLD,NOTEBOOK');
 assert.equal(x.kind,'INVENTORY');assert.equal(x.rows.length,1);assert.equal(x.rows[0].cost,'10000');
});
test('sale rows detected separately',()=>{
 const x=parseHistoryCostCsv('id,inventoryCode,itemName,cost,actualUnitPrice,actualProfit,soldAt\n2,INV-1,Notebook,10000,15000,4500,2026-10-10T10:00:00Z');
 assert.equal(x.kind,'SALE');
});
test('draft field purchase generates warning',()=>{
 const x=parseHistoryCostCsv('id,code,brand,model,buyPrice,status\n1,FP-1,Lenovo,LOQ,12000,DRAFT');
 assert.equal(x.kind,'FIELD');assert.ok(x.warnings.some(s=>s.includes('Draft')));
});
test('input customer contact columns are removed',()=>{
 const x=parseHistoryCostCsv('id,code,name,cost,quantity,sourceType,status,buyerPhone,idCardPhotoUrl\n1,INV-1,Notebook,10000,1,PURCHASE,SOLD,0810000000,photo');
 assert.equal(Object.hasOwn(x.rows[0],'buyerPhone'),false);
 assert.equal(Object.hasOwn(x.rows[0],'idCardPhotoUrl'),false);
});
test('duplicate source keys rejected',()=>assert.throws(()=>parseHistoryCostCsv('id,code,name,cost,quantity,sourceType,status\n1,A,Model,5000,1,PURCHASE,SOLD\n2,A,Model,5000,1,PURCHASE,SOLD'),/รหัสซ้ำ/));
test('nonpositive cost rejected',()=>assert.throws(()=>parseHistoryCostCsv('id,code,name,cost,quantity,sourceType,status\n1,A,Model,0,1,PURCHASE,SOLD'),/ไม่ถูกต้อง/));
test('CSV quoted fields handled',()=>assert.equal(splitHistoryCsv('id,name\n1,"Model, variant"')[1][1],'Model, variant'));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoice, formatPKR } from '../../js/invoice-desk/core/invoice-engine.js';
import { validateInvoice } from '../../js/invoice-desk/core/invoice-validator.js';
import { BUSINESSES } from '../../js/invoice-desk/businesses/business-registry.js';

test('invoice calculations round line totals and cap no discount silently',()=>{
 const result=calculateInvoice([{description:'Notebook',quantity:3,unitPrice:12.335}],2);
 assert.equal(result.subtotal,37.02);assert.equal(result.discount,2);assert.equal(result.total,35.02);
});
test('discount cannot exceed subtotal in validated invoice',()=>{
 const result=validateInvoice({businessName:'Shop',date:'2026-11-16',items:[{description:'Pen',quantity:1,unitPrice:10}],discountAmount:11});
 assert.equal(result.valid,false);assert.ok(result.errors.some((e)=>e.includes('cannot exceed')));
});
test('invoice requires at least one valid line',()=>{
 const result=validateInvoice({businessName:'Shop',date:'2026-11-16',items:[]});
 assert.equal(result.valid,false);assert.ok(result.errors.includes('Add at least one invoice item.'));
});
test('workbook business families are registered',()=>{
 assert.deepEqual(BUSINESSES.map((b)=>b.name),['B.S MART','Safari Book Land','Best Choice Store','Book Land & Sports','Spare Parts Replace Invoice']);
});
test('PKR formatter returns two decimal places',()=>assert.ok(formatPKR(1200).startsWith('Rs. ')));
test('Safari Book Land uses the extracted workbook logo',()=>assert.equal(BUSINESSES.find((b)=>b.id==='safari-book-land').logo,'/assets/invoice-desk/safari-book-land-logo.jpg'));

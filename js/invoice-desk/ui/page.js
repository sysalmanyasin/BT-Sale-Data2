import { BUSINESSES, getBusiness } from '../businesses/business-registry.js';
import { calculateInvoice, formatPKR } from '../core/invoice-engine.js';
import { validateInvoice } from '../core/invoice-validator.js';
import { renderInvoiceHtml } from '../templates/receipt-template.js';
import { printInvoice } from '../printing/print-engine.js';
let mounted = false, items = [];
const byId = (id) => document.getElementById(id);
const val = (id) => byId(id)?.value ?? '';
const escapeText = (text) => String(text).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function status(message, error = false) { const node=byId('id-status'); if(node){node.textContent=message;node.classList.toggle('is-error',error);} }
function invoice() {
 const b=getBusiness(val('id-business')), totals=calculateInvoice(items,Number(val('id-discount')||0));
 return {...b,businessName:val('id-business-name').trim(),address:val('id-address').trim(),phone:val('id-phone').trim(),date:val('id-date'),invoiceNumber:val('id-number').trim()||'DRAFT',cashier:val('id-cashier').trim(),customerName:val('id-customer').trim(),customerPhone:val('id-customer-phone').trim(),items:totals.items,subtotal:totals.subtotal,discount:totals.discount,total:totals.total,discountAmount:Number(val('id-discount')||0),footer:'Thank you.'};
}
function drawItems() {
 const body=byId('id-items-body'); if(!body)return;
 body.innerHTML=items.length?items.map((it,i)=>'<tr><td>'+escapeText(it.description)+'</td><td>'+it.quantity+'</td><td>'+formatPKR(it.unitPrice)+'</td><td>'+formatPKR(it.quantity*it.unitPrice)+'</td><td><button type="button" data-id-remove="'+i+'">Remove</button></td></tr>').join(''):'<tr><td colspan="5" class="id-empty">No items added yet.</td></tr>';
 const t=calculateInvoice(items,Number(val('id-discount')||0));byId('id-subtotal').textContent=formatPKR(t.subtotal);byId('id-net').textContent=formatPKR(t.total);
}
function setBusiness(id){const b=getBusiness(id);byId('id-business-name').value=b.name;byId('id-address').value=b.address;byId('id-phone').value=b.phone;drawItems();}
function addItem(){
 const description=val('id-item-name').trim(),quantity=Number(val('id-item-qty')),unitPrice=Number(val('id-item-price'));
 if(!description||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0){status('Enter an item description, quantity above zero and a valid non-negative rate.',true);return;}
 items.push({description,quantity,unitPrice});byId('id-item-name').value='';byId('id-item-qty').value='1';byId('id-item-price').value='0';status('Item added to this draft.');drawItems();
}
function preview(){const inv=invoice(),v=validateInvoice(inv);if(!v.valid){status(v.errors.join(' '),true);return;}byId('id-preview-content').innerHTML=renderInvoiceHtml(inv);byId('id-preview-panel').hidden=false;status('Preview ready. This remains a draft and is not in shared history.');}
function doPrint(format){const inv=invoice(),v=validateInvoice(inv);if(!v.valid){status(v.errors.join(' '),true);return;}printInvoice(inv,format);status('Print/PDF request sent. No permanent invoice record has been created.');}
export function mountInvoiceDesk(){
 if(mounted||!byId('page-invoice-desk'))return;mounted=true;
 byId('id-business').innerHTML=BUSINESSES.map((b)=>'<option value="'+b.id+'">'+escapeText(b.name)+'</option>').join('');
 byId('id-date').value=new Date().toISOString().slice(0,10);setBusiness(BUSINESSES[0].id);
 byId('id-business').addEventListener('change',(e)=>setBusiness(e.target.value));byId('id-add-item').addEventListener('click',addItem);byId('id-discount').addEventListener('input',drawItems);
 byId('id-items-body').addEventListener('click',(e)=>{const b=e.target.closest('[data-id-remove]');if(!b)return;items.splice(Number(b.dataset.idRemove),1);drawItems();status('Item removed from draft.');});
 byId('id-preview').addEventListener('click',preview);byId('id-close-preview').addEventListener('click',()=>{byId('id-preview-panel').hidden=true;});
 byId('id-print-a4').addEventListener('click',()=>doPrint('a4'));byId('id-print-58').addEventListener('click',()=>doPrint('58mm'));byId('id-print-80').addEventListener('click',()=>doPrint('80mm'));drawItems();
}

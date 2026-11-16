import { renderDoc, renderThermal } from '../../lib/print.js';
import { renderInvoiceHtml } from '../templates/receipt-template.js';
import { formatPKR } from '../core/invoice-engine.js';

function loadImage(src) {
 return new Promise((resolve,reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not load the original business logo: '+src));
  image.src = src;
 });
}
function renderA4(invoice) {
 renderDoc(async () => {
  if (!window.jspdf?.jsPDF) throw new Error('PDF library is not available. Check your connection and try again.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth(), margin = 15;
  let y = 20;
  if (invoice.logo) {
   const logo = await loadImage(invoice.logo);
   doc.addImage(logo,'JPEG',pageWidth/2-22,9,44,18);
   y = 33;
  }
  doc.setFont('helvetica','bold'); doc.setFontSize(19);
  doc.text(invoice.businessName || 'Invoice', pageWidth/2, y, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); y += 7;
  if (invoice.address) { doc.text(invoice.address, pageWidth/2, y, {align:'center'}); y += 5; }
  if (invoice.phone) { doc.text(invoice.phone, pageWidth/2, y, {align:'center'}); y += 5; }
  y += 5;
  doc.setFont('helvetica','bold'); doc.text('Invoice: '+(invoice.invoiceNumber || 'DRAFT'), margin, y);
  doc.setFont('helvetica','normal'); doc.text('Date: '+(invoice.date || ''), pageWidth-margin, y, {align:'right'});
  y += 6;
  if (invoice.customerName) { doc.text('Customer: '+invoice.customerName, margin, y); y += 5; }
  if (invoice.cashier) { doc.text('Prepared by: '+invoice.cashier, margin, y); y += 5; }
  doc.autoTable({
   startY:y+3, margin:{left:margin,right:margin}, theme:'grid',
   head:[['Description','Qty','Unit price','Amount']],
   body:invoice.items.map((item)=>[item.description,String(item.quantity),formatPKR(item.unitPrice),formatPKR(item.amount)]),
   styles:{font:'helvetica',fontSize:9,cellPadding:3},
   headStyles:{fontStyle:'bold',fillColor:[238,242,247],textColor:[20,30,45]},
   columnStyles:{0:{cellWidth:'auto'},1:{halign:'right',cellWidth:20},2:{halign:'right',cellWidth:35},3:{halign:'right',cellWidth:35}}
  });
  let ty=doc.lastAutoTable.finalY+10;
  doc.setFontSize(10);
  [['Subtotal',invoice.subtotal],['Discount',invoice.discount],['Net payable',invoice.total]].forEach(([label,amount],i)=>{
   doc.setFont('helvetica',i===2?'bold':'normal');
   doc.text(label, pageWidth-80, ty);
   doc.text(formatPKR(amount), pageWidth-margin, ty, {align:'right'});
   ty+=6;
  });
  doc.setFont('helvetica','normal');doc.setFontSize(9);
  doc.text(invoice.footer || 'Thank you.',pageWidth/2,Math.min(ty+10,280),{align:'center'});
  return {doc,title:(invoice.businessName||'Invoice')};
 }, {filename:(invoice.businessName||'Invoice')+'-'+(invoice.invoiceNumber||'draft')});
}
export function printInvoice(invoice, format='a4') {
 const filename=(invoice.businessName||'Invoice')+'-'+(invoice.invoiceNumber||'draft');
 if(format==='58mm'||format==='80mm'){
  const widthMM=format==='58mm'?58:80;
  renderThermal(renderInvoiceHtml(invoice,{thermal:true,widthMM}),{widthMM,filename:filename+'-'+format});
  return;
 }
 renderA4(invoice);
}

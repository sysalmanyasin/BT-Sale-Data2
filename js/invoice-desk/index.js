import { mountInvoiceDesk } from './ui/page.js';
function activate(){if(window.location.hash==='#invoice-desk')mountInvoiceDesk();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',activate,{once:true});else activate();
window.addEventListener('hashchange',activate);

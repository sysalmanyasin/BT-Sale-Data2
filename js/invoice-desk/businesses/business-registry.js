// Business names are taken from the supplied workbook. Missing identity data
// stays blank until verified; logo assets are never fabricated.
export const BUSINESSES = Object.freeze([
 { id:'bs-mart', name:'B.S MART', template:'retail-receipt', logo:null, address:'', phone:'' },
 { id:'safari-book-land', name:'Safari Book Land', template:'bookstore-receipt', logo:'/assets/invoice-desk/safari-book-land-logo.jpg', address:'', phone:'' },
 { id:'best-choice-store', name:'Best Choice Store', template:'discount-receipt', logo:null, address:'', phone:'' },
 { id:'book-land-sports', name:'Book Land & Sports', template:'business-invoice', logo:null, address:'', phone:'' },
 { id:'spare-parts-replace', name:'Spare Parts Replace Invoice', template:'vehicle-service-invoice', logo:null, address:'', phone:'' },
]);
export function getBusiness(id) { return BUSINESSES.find((business) => business.id === id) || BUSINESSES[0]; }

/* Default billing set-up, taken from Greenspace Consulting's recent Xero invoices (Aug to Oct 2026).
   Every value can be changed on the Setup page; changes are saved in this browser. */
window.GS_BILLING_DEFAULTS = {
  consultant: 'S Cameron-Lee',
  accountCode: '200',          // Sales
  taxType: 'OUTPUT2',          // 15% GST on Income (Xero API code)
  taxLabel: '15% GST on Income',
  nextInvoiceNumber: 'INV-0524',
  // Clients that never get invoiced (internal time)
  nonBillable: ['Admin', 'Travel', 'LCC', 'GS', 'GE', 'Gardeners Emporium', 'Broking'],
  contacts: {
    'Auckland Council': 'd52131c3-e667-48b6-b081-75254a5b8124',
    'Queenstown Lakes District Council': '640a3e8b-a536-4ec9-827f-0afd0ce2ba80',
    'Hastings District Council': '09d6c86f-fcdb-451f-8c20-62ca2f1cadd7',
    'Arborlab Consultancy Services Limited': '3a515d11-cc89-4732-9c7a-715a2ade48aa',
    'Peter Delmont': 'ca8fb998-b1d0-4e8c-8b4a-8205578098d0',
    'P Delmont': 'de417b87-3630-4eff-b652-3b87f3c33945',
    'Angie Bao': 'c9138340-7e5a-486c-8d83-a025af37524a',
    'Vicki & Wayne Leathard': 'c5941301-293b-4b4e-a5e7-319849f2efa9',
    'Polly & Keith Walters': 'b8442726-5d2a-4d9f-82e0-5a4de454665e',
    'Libby Lewis': '1f733476-3868-448c-9aaa-95ea603cd86e',
    'Katherine Allsopp-Smith': 'afce62fc-714f-4f7d-8355-a63f36ca67b4'
  },
  // key "Client|Project" (or "Client|*" for every project of that client)
  projects: {
    'AC|SF': { contact: 'Auckland Council', reference: '6500136549', header: 'Project Management Services – Sports Delivery Programme {month}', due: '20th' },
    'AC|SF Projects': { contact: 'Auckland Council', reference: '6500136549', header: 'Project Management Services – Sports Delivery Programme {month}', due: '20th' },
    'AC|Tender': { contact: 'Auckland Council', reference: '6500168661', header: 'P27 - Sports Field Tender Evaluation', due: '20th' },
    'AC|Riverhead War Memorial': { contact: 'Auckland Council', reference: 'PO 3000435011', header: 'Riverhead War Memorial Sports Field Upgrade', due: '20th' },
    'AC|Stadiums': { contact: 'Auckland Council', reference: '', header: 'Stadiums - Natural Turf Contract', due: '20th' },
    'AC|Arb Contract': { contact: 'Arborlab Consultancy Services Limited', reference: 'AC 2028 Arb Contract', header: '2028 Arb Contract', due: '20th' },
    'AC|Ecological': { contact: 'Arborlab Consultancy Services Limited', reference: 'Wildlands', header: 'Wildlands Ecological', due: '20th' },
    'AC|Ecological Road Corridor': { contact: 'Arborlab Consultancy Services Limited', reference: 'Wildlands', header: 'Wildlands Ecological - Road Corridor', due: '20th' },
    'AC|Vector': { contact: 'Arborlab Consultancy Services Limited', reference: 'Vector', header: 'Vector', due: '20th', check: true },
    'AC|*': { contact: 'Auckland Council', reference: '', header: '', due: '20th' },
    'QLDC|Sports': { contact: 'Queenstown Lakes District Council', reference: '', header: 'Wanaka Showgrounds Renewal', due: '20th' },
    'QLDC|*': { contact: 'Queenstown Lakes District Council', reference: '', header: '', due: '20th' },
    'HDC|*': { contact: 'Hastings District Council', reference: '', header: '', due: '20th' },
    'Arborlab|*': { contact: 'Arborlab Consultancy Services Limited', reference: '', header: '', due: '20th' },
    'Consulting|*': { contact: '', reference: '', header: '', due: '20th' },
    'P Delmont|*': { contact: 'Peter Delmont', reference: 'Landscaping Services', header: '', due: '2' },
    'Angie|*': { contact: 'Angie Bao', reference: 'Landscaping Services', header: '', due: '3' },
    'Leathard|*': { contact: 'Vicki & Wayne Leathard', reference: 'Landscaping Services', header: '', due: '3' },
    'Walters|*': { contact: 'Polly & Keith Walters', reference: 'Landscaping Services', header: '', due: '3' },
    'Libby|*': { contact: 'Libby Lewis', reference: 'Landscaping Services', header: '', due: '3' }
  }
};

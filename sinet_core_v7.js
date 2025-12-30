/**
 * SINET ERP v17.1 CORE (AUDIT + TAX CALENDAR + GENERATOR)
 * Spaja sigurnosni Audit Log sa naprednim Generatorom poreza i troškova.
 */

const SINET = {
    version: "17.1 Ultimate",
    
    DB: {
        prefix: "sinet_v7_",
        get: (t) => { try { return JSON.parse(localStorage.getItem(SINET.DB.prefix + t)) || []; } catch (e) { return []; } },
        
        // --- INTERCEPTOR: SVAKI SAVE SE BELEŽI U AUDIT ---
        save: (t, d) => { 
            try { 
                localStorage.setItem(SINET.DB.prefix + t, JSON.stringify(d)); 
                // Beležimo sistemski upis (low level log)
                SINET.Audit.log("DB_WRITE", `Tabela: ${t.toUpperCase()}`, `Records: ${d.length}`);
                return true; 
            } catch (e) { 
                alert("CRITICAL ERROR: Disk Full!"); 
                return false; 
            } 
        },
        markAsExported: (id) => {
            const docs = SINET.DB.get('docs');
            const idx = docs.findIndex(d => d.id === id);
            if (idx > -1) { 
                docs[idx].sef_status = 'SENT'; 
                SINET.DB.save('docs', docs); 
                SINET.Audit.log("SEF_EXPORT", `Faktura ${docs[idx].num} poslata`, "Status: SENT");
                return true; 
            }
            return false;
        }
    },

    // --- AUDIT SYSTEM (CRNA KUTIJA) ---
    Audit: {
        log: (action, desc, meta = "") => {
            const logs = JSON.parse(localStorage.getItem(SINET.DB.prefix + 'sys_audit')) || [];
            const entry = {
                ts: new Date().toISOString(),
                act: action,
                desc: desc,
                meta: meta,
                user: "Admin"
            };
            logs.unshift(entry);
            if(logs.length > 2000) logs.pop(); // Čuvamo 2000 zapisa
            localStorage.setItem(SINET.DB.prefix + 'sys_audit', JSON.stringify(logs));
        }
    },

    Util: {
        fmtMoney: (n, c = "RSD") => new Intl.NumberFormat('sr-RS', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(n) + (c ? " " + c : ""),
        fmtDate: (d) => d ? d.split('-').reverse().join('.') : '',
        parseMoney: (s) => parseFloat((s||"0").toString().replace(/[^0-9.-]/g, "")) || 0,
        uuid: () => Date.now().toString(36) + Math.random().toString(36).substr(2)
    },

    Config: {
        load: () => {
            const c = SINET.DB.get('config');
            return Object.keys(c).length ? c : {
                firma: { naziv: "Moja Firma", pib: "100000001", mb: "20000001" },
                adresa: { ulica: "Glavna 1", mesto: "Beograd" },
                kontakt: { email: "info@firma.rs", telefon: "011/000000" },
                banka: { racun1: "160-000000-00", banka1: "Banka", footer_text: "Hvala na poverenju." },
                vizual: { logo: "", potpis: "" }, system: { pdv_obveznik: "true" }
            };
        },
        save: (d) => { SINET.DB.save('config', d); SINET.Audit.log("CONFIG", "Izmena podešavanja"); alert("Sačuvano!"); }
    },

    Theme: {
        apply: () => {
            const mode = localStorage.getItem('sinet_theme') || 'light';
            if (mode === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
        },
        toggle: () => {
            const isDark = document.documentElement.classList.contains('dark');
            localStorage.setItem('sinet_theme', isDark ? 'light' : 'dark');
            SINET.Theme.apply();
        }
    },

    Stock: {
        getQty: (artName) => {
            if(!artName) return 0;
            const entries = SINET.DB.get('stock_entries') || [];
            const totalIn = entries.filter(e => e.art === artName).reduce((sum, e) => sum + parseFloat(e.qty), 0);
            const docs = SINET.DB.get('docs') || [];
            let totalOut = 0;
            docs.forEach(d => {
                if (d.type.includes('FAKTURA') || d.type.includes('AVANS') || d.type.includes('OTPREM')) {
                    const items = (typeof d.items === 'string') ? JSON.parse(d.items) : (d.items || []);
                    items.forEach(it => { if (it.desc === artName && it.type === 'prod') totalOut += parseFloat(it.qty) || 0; });
                }
                if (d.type.includes('KNJIŽNO')) {
                    const items = (typeof d.items === 'string') ? JSON.parse(d.items) : (d.items || []);
                    items.forEach(it => { if (it.desc === artName && it.type === 'prod') totalOut -= parseFloat(it.qty) || 0; });
                }
            });
            return totalIn - totalOut;
        },
        addEntry: (artName, qty, note) => {
            const entries = SINET.DB.get('stock_entries') || [];
            entries.push({ id: SINET.Util.uuid(), date: new Date().toISOString().split('T')[0], art: artName, qty: parseFloat(qty), note: note || "Ručni unos" });
            SINET.DB.save('stock_entries', entries);
            SINET.Audit.log("STOCK", `Korekcija: ${artName}`, `Kol: ${qty}`);
        }
    },

    FinTech: {
        generateIPSString: (d) => `K:PR|V:01|C:1|R:${d.account.replace(/[^0-9]/g,"")}|N:${d.recipient.substring(0,70)}|I:RSD${d.total.toFixed(2).replace('.',',')}|SF:289|S:Racun ${d.docNum}|RO:${d.docNum}`
    },

    SEF: {
        generateXML: (doc, config) => { 
             try {
                if (!doc.items || doc.items.length === 0) throw new Error("Nema stavki!");
                const itemsXML = doc.items.map((it, i) => {
                    const lineTotal = (it.qty * it.price).toFixed(2);
                    return `<cac:InvoiceLine><cbc:ID>${i+1}</cbc:ID><cbc:InvoicedQuantity unitCode="H87">${it.qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="RSD">${lineTotal}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${it.desc}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="RSD">${it.price.toFixed(2)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
                }).join('');
                let totalNet = SINET.Util.parseMoney(doc.total_net) || 0;
                const totalTax = totalNet * 0.20; const totalGross = totalNet + totalTax;
                return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:mfin.gov.rs:srbdt:2021</cbc:CustomizationID><cbc:ID>${doc.num}</cbc:ID><cbc:IssueDate>${doc.date}</cbc:IssueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>RSD</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>${config.firma.naziv}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:CompanyID>RS${config.firma.pib}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${config.firma.naziv}</cbc:RegistrationName><cbc:CompanyID>${config.firma.mb}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>${doc.client.name}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:CompanyID>RS${doc.client.pib}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty><cac:TaxTotal><cbc:TaxAmount currencyID="RSD">${totalTax.toFixed(2)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="RSD">${totalNet.toFixed(2)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="RSD">${totalTax.toFixed(2)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="RSD">${totalNet.toFixed(2)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="RSD">${totalNet.toFixed(2)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="RSD">${totalGross.toFixed(2)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="RSD">${totalGross.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${itemsXML}</Invoice>`;
            } catch (e) { alert("Greška XML: " + e.message); return null; }
        },
        download: (filename, content) => { const element = document.createElement('a'); element.setAttribute('href', 'data:text/xml;charset=utf-8,' + encodeURIComponent(content)); element.setAttribute('download', filename); element.style.display = 'none'; document.body.appendChild(element); element.click(); document.body.removeChild(element); }
    },

    System: {
        backup: () => {
            const data = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(SINET.DB.prefix)) data[key] = localStorage.getItem(key);
            }
            const blob = new Blob([JSON.stringify(data)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `SINET_BACKUP_${new Date().toISOString().split('T')[0]}.json`; a.click();
            SINET.Audit.log("BACKUP", "Preuzet backup fajl");
        },

        restore: (fileInput) => {
            const file = fileInput.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    Object.keys(data).forEach(key => { if (key.startsWith(SINET.DB.prefix)) localStorage.setItem(key, data[key]); });
                    SINET.Audit.log("RESTORE", "Sistem vraćen iz backup-a");
                    alert("✅ Podaci vraćeni! Osvežavam..."); location.reload();
                } catch (err) { alert("❌ Fajl je oštećen."); }
            };
            reader.readAsText(file);
        },

        nuke: () => { 
            if(confirm("⚠️ OVO BRIŠE SVE PODATKE!\nDa li ste sigurni?")) { 
                const p=SINET.DB.prefix; 
                const c=localStorage.getItem(p+'config'); 
                Object.keys(localStorage).forEach(k=>{if(k.startsWith(p))localStorage.removeItem(k)}); 
                if(c)localStorage.setItem(p+'config',c); 
                // Prvi log u novom sistemu
                SINET.Audit.log("SYSTEM_RESET", "Kompletan reset sistema (Factory Reset)");
                alert("✅ Sistem je očišćen."); 
                location.reload(); 
            } 
        },
        
        // --- ULTIMATE GENERATOR (POREZI + RASHODI + AUDIT) ---
        seed: (count) => {
            try {
                if (!confirm(`Generisati ${count} novih stavki?`)) return;
                
                SINET.Audit.log("GEN_START", `Početak generisanja ${count} stavki`);

                // 1. Klijenti
                const companies = ["Lidl", "Metalac", "Tehnomanija", "NIS", "Telekom", "Delhaize", "Bambi", "Imlek"];
                const suppliers = ["Gigatron", "Woby Haus", "Office 1", "Eko Pumpa", "Stovarište Jela", "EPS Snabdevanje"];
                const clients = [];
                companies.forEach((n,i)=>clients.push({id:SINET.Util.uuid(), type:"KUPAC", osnovno:{naziv:n, pib:"100"+i}, kontakt:{adresa:"Bulevar "+i}, komercijala:{status:"OK"}}));
                suppliers.forEach((n,i)=>clients.push({id:SINET.Util.uuid(), type:"DOBAVLJAČ", osnovno:{naziv:n, pib:"200"+i}, kontakt:{adresa:"Ind. Zona "+i}, komercijala:{status:"OK"}}));
                SINET.DB.save('clients', clients);

                // 2. Artikli (v13 cene)
                const artData = [{n:"Web Sajt",p:45000},{n:"Održavanje",p:5000},{n:"Hosting",p:12000},{n:"SEO",p:25000},{n:"Servis",p:3500},{n:"Toner HP",p:2500}];
                const articles = artData.map((a,i)=>({id:SINET.Util.uuid(), name:a.n, price:a.p, cost_price:a.p*0.6, unit:"kom", code:"A"+i}));
                SINET.DB.save('articles', articles);

                // 3. Lager
                const entries = [];
                articles.forEach(a => entries.push({id:SINET.Util.uuid(), date:"2025-01-01", art:a.name, qty:100, note:"Početno stanje"}));
                SINET.DB.save('stock_entries', entries);

                // 4. Fakture, Ponude & RASHODI
                const docs=[], quotes=[], recs=[], expenses=[];
                const expCats = ["NABAVKA ROBE", "ZAKUP I REŽIJE", "GORIVO I PUTNI", "MARKETING"];

                for(let i=1; i<=count; i++) {
                    const c = clients.filter(x=>x.type==="KUPAC")[Math.floor(Math.random()*companies.length)];
                    const a = articles[Math.floor(Math.random()*articles.length)];
                    const dateStr = `2025-${String(Math.floor(Math.random()*12)+1).padStart(2,'0')}-${String(Math.floor(Math.random()*28)+1).padStart(2,'0')}`;
                    
                    // Faktura
                    docs.push({id:SINET.Util.uuid(), type:'FAKTURA', num:`2025-${String(i).padStart(3,'0')}`, date:dateStr, client:{name:c.osnovno.naziv, pib:c.osnovno.pib}, total:SINET.Util.fmtMoney(a.price), total_net:SINET.Util.fmtMoney(a.price/1.2), items:[{type:'prod', desc:a.name, qty:1, price:a.price/1.2}], sef_status:'NEW'});
                    
                    // Ponuda (svaki 3.)
                    if(i%3===0) quotes.push({id:SINET.Util.uuid(), num:`PON-${i}`, date:dateStr, client:c.osnovno.naziv, status:'DRAFT', total:SINET.Util.fmtMoney(a.price)});
                    
                    // RASHOD (svaki 2.) - OBAVEZNO!
                    if(i%2===0) {
                        const sup = clients.filter(x=>x.type==="DOBAVLJAČ")[Math.floor(Math.random()*suppliers.length)];
                        expenses.push({id: SINET.Util.uuid(), date: dateStr, vendor: sup.osnovno.naziv, ref: "UF-"+i, cat: expCats[Math.floor(Math.random()*expCats.length)], amount: Math.floor(Math.random() * 15000) + 2000});
                    }
                }
                
                SINET.DB.save('docs', docs); 
                SINET.DB.save('quotes', quotes); 
                SINET.DB.save('expenses', expenses);

                // 5. PORESKI KALENDAR (TASKOVI) - AUTOMATIKA
                const tasks = [];
                const year = new Date().getFullYear();
                for(let m=1; m<=12; m++) {
                    const mm = String(m).padStart(2,'0');
                    // Zakonski rokovi
                    tasks.push({id: SINET.Util.uuid(), title: `Plati PDV za ${m}. mesec`, date: `${year}-${mm}-15`, priority: "HIGH", done: false});
                    tasks.push({id: SINET.Util.uuid(), title: `Isplata zarada (Plate) za ${m}. mesec`, date: `${year}-${mm}-30`, priority: "HIGH", done: false});
                    tasks.push({id: SINET.Util.uuid(), title: `Porez i doprinosi za ${m}. mesec`, date: `${year}-${mm}-30`, priority: "HIGH", done: false});
                }
                SINET.DB.save('tasks', tasks);
                
                // Ugovori
                SINET.DB.save('recurring', [{id:SINET.Util.uuid(), client:clients[0].osnovno.naziv, item:articles[1].name, price:articles[1].price, note:"Održavanje", active:true}]);

                // 6. FINALNI AUDIT ZAPIS
                const report = `Kreirano: ${docs.length} Faktura, ${expenses.length} Rashoda, ${tasks.length} Poreskih obaveza.`;
                SINET.Audit.log("GEN_SUCCESS", "Generisanje uspešno završeno", report);

                alert(`✅ GENERISANJE USPEŠNO!\n\n${report}\n\nProverite Dashboard i Audit Log!`);
                location.reload();

            } catch (err) { 
                SINET.Audit.log("GEN_ERROR", "Greška pri generisanju", err.message);
                alert("GREŠKA: " + err.message); 
                console.error(err); 
            }
        }
    }
};

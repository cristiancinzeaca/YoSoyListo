# Yo Soy Listo — rezumat complet al proiectului

Document de predare: tot ce trebuie știut ca să se continue lucrul într-un chat nou (de exemplu în Cowork). Ultima actualizare: 12 octombrie 2026.

---

## 1. Ce este

Joc de întrebări de cultură generală **în spaniolă** (public: Spania), gândit pentru **telefon**, care se joacă în browser. Gratuit, fără înregistrare (doar un nume).

**Moduri de joc**
| Mod | Pagina | Descriere |
|---|---|---|
| **Conquista** (modul principal) | `/conquista` | 3 jucători, harta Spaniei pe cele 17 comunități autonome, castel cu 3 turnuri pentru fiecare. Stil Conquistador / Honfoglaló. Dacă nu se strâng 3 oameni în 15 s, se completează cu boți. |
| Blitz | `/blitz` | Solo, 60 de secunde, serii de răspunsuri corecte care multiplică punctele (x2, x3). Clasament săptămânal și general. |
| Duel | `/duelo` | 1 contra 1 online; bot după 12 s dacă nu apare nimeni. Clasament ELO. |
| Sală privată | `/sala?crear=1` | Până la 8 jucători cu cod/link, boți opționali, revanșă. Puncte după viteză. |

**Regulile Conquista**
1. *Împărțirea*: întrebare cu răspuns numeric pentru toți 3; cel mai apropiat alege 2 regiuni libere vecine, al doilea alege 1 (200 puncte fiecare). Se repetă până se umple harta.
2. *Bătălia*: 3 runde; pe rând, fiecare atacă o regiune vecină. Atacatorul și apărătorul răspund la aceeași întrebare cu variante; dacă amândoi răspund corect → departajare cu întrebare numerică. Cucerirea adaugă +100 la valoarea regiunii; apărarea reușită dă +100 apărătorului. Castelul (1000 puncte) cade după 3 atacuri câștigate și atacatorul ia tot teritoriul jucătorului eliminat.
3. Câștigă cine are cele mai multe puncte la final.

**Alte funcții**: profil cu statistici și istoric (`/perfil`), raportare de întrebări greșite (butonul ⚑), panou de administrare (`/admin/`), pagină de confidențialitate, sitemap/robots, PWA (se poate instala pe telefon), pagină 404.

---

## 2. Unde este

- **Cod**: GitHub `cristiancinzeaca/YoSoyListo`, ramura `main`.
- **Hosting**: Railway, proiectul „YoSoyListo”, regiunea EU West. **Fiecare modificare pusă în `main` se publică automat** în 1–2 minute.
- **Baza de date**: PostgreSQL în același proiect Railway. Serverul creează singur tabelele și încarcă întrebările la pornire.
- **Variabile în Railway** (serviciul YoSoyListo): `DATABASE_URL = ${{Postgres.DATABASE_URL}}`, `ADMIN_KEY` (parola panoului admin), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` și `PUBLIC_URL` (adresa site-ului, ex. `https://yosoylisto.up.railway.app`) — fără ultimele trei nu se poate intra în joc.
- **Domeniu**: încă nu există (se folosește adresa `*.up.railway.app`). Plan: un domeniu `.es`/`.com` (~10–15 €/an) legat din Railway → Settings → Networking → Custom Domain, apoi variabila `PUBLIC_URL`.
- **Cost**: Railway Hobby ~5 $/lună.
- Proiectul Supabase creat la început **nu mai este folosit** (poate fi șters).

---

## 3. Arhitectura (pentru programator)

- **Backend**: Node.js 22 + Express 5, un singur server care servește și site-ul, și API-ul, și WebSocket-ul (`/ws`). Fără pas de build.
- **Frontend**: HTML + CSS + JavaScript simplu, fără framework, în `backend/public/`.
- **Baza de date**: PostgreSQL direct (`DATABASE_URL`, adaptor în `core/pgdb.js`) sau, alternativ, Supabase.

```
package.json                 → permite deploy din rădăcină (pornește backend/)
backend/
  core/        server.js (Express, CSP, rute), db.js, pgdb.js, migrate.js, http.js, rateLimit.js
  db/          schema.sql (toate tabelele), seed.sql (GENERAT), build-seed.js
               questions/<categorie>.json  → 473 întrebări cu variante
               numeric/aproximacion.json   → 119 întrebări numerice (Conquista)
  modules/
    questions/   întrebări, categorii, rapoarte de erori (API admin)
    game-blitz/  modul Blitz
    players/     profiluri de invitat (nume + token în browser), clasamente
    multiplayer/ hub WebSocket, dueluri, săli, boți, ELO
    conquista/   game.js (regulile), map.js, config.js (timpi și punctaje), persist.js
  public/      index.html, conquista.html, blitz.html, online.html (duel+sală), perfil.html,
               privacidad.html, 404.html, styles.css, js/*.js, admin/, fonts/, map/espana.json,
               icon.svg, icon-192.png, icon-512.png, manifest.webmanifest
  test/        28 de teste automate (npm test)
```

**Comenzi**
```bash
cd backend
npm install
npm test                 # toate testele
npm run seed             # regenerează db/seed.sql după ce modifici întrebările
cp .env.example .env     # completează DATABASE_URL și ADMIN_KEY
npm run dev              # http://localhost:3000
```

---

## 4. Reguli importante pentru cine continuă

- **Textele din joc sunt în spaniolă** (din Spania). Conversația cu proprietarul e în română.
- **CSP strict** (securitate): fără `<script>` inline, fără `style="..."` inline, fără resurse externe. Imaginile, fonturile și scripturile trebuie să fie **fișiere locale** în `backend/public/` (`img-src 'self' data:`). Dacă e nevoie de un CDN, trebuie modificat CSP-ul în `backend/core/server.js`.
- **Telefonul e prioritar**: totul se testează la ~390 px lățime.
- **Culorile** sunt variabile CSS în `:root` din `backend/public/styles.css` (fundal violet închis `#1b1035`, galben `#ffcb2b`, violet `#7c4dff`). Fontul e Nunito, găzduit local.
- **Culorile jucătorilor în Conquista**: roșu `#e5484d`, albastru `#3e8ef7`, verde `#2fbf71` (în `modules/conquista/game.js`).
- **Harta** (`public/map/espana.json`) e generată din datele IGN (CC BY 4.0) — trebuie păstrată atribuirea afișată sub hartă.
- După orice modificare: `npm test`, apoi PR în `main` → Railway publică singur.
- **Nu se pun parole sau chei în chat sau în cod.** (Atenție: în conversația anterioară s-au scris în chat parola Supabase și o variantă de parolă admin — trebuie schimbate dacă sunt folosite în altă parte.)

---

## 5. GRAFICA (în lucru)

**Făcut (12 octombrie 2026, ramura `grafica-y-efectos`)**
- Imagini generate cu ChatGPT, stil unitar (vector „flat”, contur gros `#1b1035`, galben/violet), în `backend/public/img/` (WebP, 10–130 KB): `logo.webp`, `hero.webp`, `og-image.jpg` (1200×630), `castillo-{rojo,azul,verde}.webp`, `avatar-{buho,zorro,gato,loro,toro,tortuga,erizo,mapache}.webp`, `modo-{conquista,blitz,duelo,sala}.webp`, iconițe noi (`icon-192/512.png`, `icon.svg`, `img/favicon-48.png`, `img/apple-touch-icon.png`).
- Avatare: boții au animalul lor (Einstein→bufniță, Curie→vulpe, Cervantes→pisică, Frida→papagal, Lorca→tăuraș, Hipatia→țestoasă, Ramón y Cajal→arici, Lovelace→raton); oamenii primesc unul după nume (`FX.avatar(name)`).
- `public/js/fx.js` (inclus pe toate paginile): sunete sintetizate cu Web Audio (fără fișiere), vibrații, confetti, chispe, texte flotante, carteluri mari, buton 🔊/🔇 în antet (`localStorage ysl:sound`). Respectă `prefers-reduced-motion`.
- Efecte în Blitz, Duel/Sală, Conquista (cucerire, torre derribată, castel căzut, rândul tău, victorie) și pe prima pagină (fundal cu stele, carduri animate, butoane cu sclipire).
- Pentru probe locale fără bază de date se poate porni serverul cu baza falsă din `test/fakeDb.js`.

**Rămas**: textură/relief pe hartă, steaguri pe regiuni, ilustrații pe categorii; `og:image` trebuie făcut URL absolut după ce există domeniul.

### Planul inițial

Obiectiv: jocul să arate „ca un joc adevărat”, nu ca un site. Idei, în ordinea impactului:

1. **Logo și identitate**: logo „Yo Soy Listo” (acum e doar text), iconița aplicației (`icon.svg`, `icon-192.png`, `icon-512.png`), imagine pentru distribuire pe rețele sociale **1200×630** (`og:image`, acum lipsește una reală).
2. **Harta Conquista**: textură/relief pe hartă, castele desenate (acum emoji 🏰), steaguri sau scuturi pe regiunile cucerite, animații la atac și la cucerire, fundal tip pergament sau mare.
3. **Avatare pentru jucători și boți** (boții au nume: Einstein, Curie, Cervantes, Frida, Lorca, Hipatia, Ramón y Cajal, Lovelace).
4. **Prima pagină**: ilustrație „hero”, carduri cu imagini pentru fiecare mod.
5. **Efecte**: sunete (răspuns corect/greșit, cucerire), confetti la victorie, vibrații pe telefon.
6. **Ilustrații pe categorii** (geografie, istorie, știință, artă, sport, general).

**Cerințe tehnice pentru imagini generate** (cu ChatGPT/DALL·E sau altele):
- Se salvează în `backend/public/img/` (folder nou) ca **WebP** (sau PNG pentru transparență), optimizate (de preferat < 200 KB fiecare).
- Iconițele: pătrate, fundal transparent sau `#1b1035`, lizibile la 48 px.
- Stilul trebuie să fie unitar (aceeași paletă și același stil de ilustrație peste tot).
- Atenție la drepturi: doar imagini generate de noi sau cu licență liberă; nimic copiat din Conquistador/Honfoglaló (nume, logo, grafică).

---

## 5b. Conturi, monede și magazin (ramura `cuentas-monedas-tienda`)

- **Contul e obligatoriu și se face doar cu Google.** Fluxul e pe server (redirecționare + cod), fără scripturi Google în pagini, deci CSP-ul rămâne strict: `/auth/google?next=…` → Google → `/auth/google/callback` → `/entrar#code=…` → `POST /api/auth/complete` → token de sesiune în browser. Fiecare dispozitiv are sesiunea lui (`player_sessions`); `POST /api/auth/logout` închide doar acel dispozitiv.
- Profilurile de invitat vechi nu mai pot juca; la prima intrare cu Google din același browser, profilul de invitat **devine contul** (păstrează nume, ELO și statistici).
- Pentru probe locale: `DEV_FAKE_GOOGLE=1` (nu funcționează niciodată în producție) și `/auth/google?dev=Nume`.
- **Monede** (`modules/shop/catalog.js` are toate cifrele): 100 la creare + un comodín din fiecare; Blitz 1/răspuns corect (+10 la record personal); Duel 25/15/8 (câștig/egal/pierdere); Sală 30/18/10/5; Conquista 50/25/10; contra boților ×0,6 în Duel/Sală; +20 la prima partidă a zilei; plafon 500/zi (ora Madridului). Cine abandonează nu primește nimic. Totul se calculează pe server (`award_coins` în SQL, cu istoric în `coin_ledger`).
- **Magazin** `/tienda`: comodines 50/50 (40), Timp extra +10 s (30, doar Blitz), Sari (25, doar Blitz, nu rupe seria), Pistă (40, doar întrebările de aproximare din Conquista); avatare: 4 gratuite (bufniță, vulpe, pisică, papagal) și 4 de cumpărat (150–200). Un comodín de fiecare tip pe întrebare. Cumpărarea e atomică (`buy_item`), consumul tot (`use_item`).
- API nou: `/api/shop/catalog`, `/api/shop/me`, `/api/shop/buy`, `/api/shop/avatar`, `/api/blitz/:id/helper`; WebSocket: mesaj `helper` (`fifty` în duel/sală/Conquista, `hint` în Conquista).

**Configurarea Google (o singură dată):** în console.cloud.google.com → proiect nou → „OAuth consent screen” (External, nume „Yo Soy Listo”, email de suport, publicare) → „Credentials” → „Create OAuth client ID” → Web application → *Authorized redirect URI*: `https://<adresa-site-ului>/auth/google/callback` → se copiază Client ID și Client secret în Railway (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) plus `PUBLIC_URL`. Dacă se schimbă domeniul, se adaugă noul redirect URI în Google și se schimbă `PUBLIC_URL`.

## 5c. Conquista el mundo — cumpără o țară (ramura `paises`)

- Pagina `/mundo`; codul în `modules/countries/` (`catalog.js` are toate regulile și prețurile), întrebările în `db/countries/<id>.json` (30 pe țară: `[text, corect, [3 greșite]]`; primele 10 sunt fixe).
- 17 țări, prețuri pe mărime: Andorra 1000; Portugalia/Grecia/Maroc 2500; Columbia/Argentina/Egipt 3500; Mexic/Italia 5000; Regatul Unit/Franța/Germania/Japonia/Brazilia 7000; Spania 10 000; China 12 000; SUA 15 000. O țară are un singur proprietar.
- Proprietarul: primește **5 %/zi** din valoarea țării (se acumulează max. 3 zile, se încasează cu „Cobrar”); poate **studia** toate întrebările cu răspunsuri; alege cele **10 întrebări de apărare**; poate **fortifica** (+5 întrebări, costă prețul țării, max. 2 ori).
- Atacul costă **100 monede**; trebuie să răspunzi corect la **toate** (10 fixe + 10 alese + 5 pe fortificație), 12 s pe întrebare. Dacă greșești: cele 100 merg la proprietar și valoarea țării crește cu 100; un jucător poate ataca aceeași țară o dată la 24 h. Dacă reușești: țara e a ta, iar fostul proprietar primește **50 %** din valoare ca despăgubire.
- În Conquista, cine are țări poate cere, la rândul lui de atac, o întrebare din țara aleasă (aliat).
- Totul e atomic în SQL: `buy_country`, `collect_income`, `conquer_country`, `defend_country`, `pay_coins`, `add_coins`; tabele `country_owners`, `country_attacks`.

## 6. Alte idei în așteptare

- **Conquista cu prietenii** (sală privată cu cod pentru 3 jucători).
- **Provocarea zilnică** (aceleași 10 întrebări pentru toți, clasament pe zi).
- **SEO**: pagini pe categorii, domeniu propriu, Google Search Console.
- **Monetizare** (când există trafic): Google AdSense + banner de cookie-uri (obligatoriu în UE) + pagina „Aviso legal” (cere numele și NIF-ul titularului).
- Mai multe întrebări și categorii (de exemplu „España”, cinema, muzică). Formatul e explicat în `README.md`.
- Aplicație pentru magazinele Android/iOS din același cod.

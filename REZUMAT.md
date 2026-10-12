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
- **Variabile în Railway** (serviciul YoSoyListo): `DATABASE_URL = ${{Postgres.DATABASE_URL}}` și `ADMIN_KEY` (parola panoului admin).
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

## 5. Următorul pas: GRAFICA

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

## 6. Alte idei în așteptare

- **Conquista cu prietenii** (sală privată cu cod pentru 3 jucători).
- **Provocarea zilnică** (aceleași 10 întrebări pentru toți, clasament pe zi).
- **Conturi cu email/Google** (ca profilul să nu se piardă când schimbi telefonul).
- **SEO**: pagini pe categorii, domeniu propriu, Google Search Console.
- **Monetizare** (când există trafic): Google AdSense + banner de cookie-uri (obligatoriu în UE) + pagina „Aviso legal” (cere numele și NIF-ul titularului).
- Mai multe întrebări și categorii (de exemplu „España”, cinema, muzică). Formatul e explicat în `README.md`.
- Aplicație pentru magazinele Android/iOS din același cod.

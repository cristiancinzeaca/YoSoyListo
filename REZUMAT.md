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
- **Variabile în Railway** (serviciul YoSoyListo): `DATABASE_URL = ${{Postgres.DATABASE_URL}}`, `ADMIN_KEY` (parola panoului admin), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` și `PUBLIC_URL` (adresa site-ului: `https://www.yosoylisto.es`) — fără ultimele trei nu se poate intra în joc.
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
               questions/<categorie>.json  → ~1260 întrebări cu variante (~200 pe categorie; multe de cultură generală internațională)
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

## 5d. Nume unice (ramura `nombres-unicos`)

- Două conturi nu pot avea același nume; se compară fără majuscule, accente și separatori („Cristián” = „cristian” = „Cris-tian”). Coloana `players.name_key` (index unic) o calculează serverul (`nameKey` în `modules/players/names.js`).
- La intrarea cu Google, dacă numele e ocupat, primește un număr: „Lucía”, „lucia2”, „Lucía3”…
- Jucătorii vechi cu nume repetate se separă singuri la pornire (`fillNameKeys` în `core/migrate.js`): cel mai vechi păstrează numele.
- **Prima schimbare de nume e gratuită**; următoarele costă **100 monede** (`COINS.rename`); doar majuscule/accente = gratis. Atomic în SQL (`rename_player`). În profil se verifică pe loc dacă numele e liber (`GET /api/players/name-check`).

## 5e. Chat (ramura `chat`)

- Buton 💬 în antetul tuturor paginilor (după login), cu 3 file: **Partida** (doar când ești într-o sală/partidă, în timp real prin WebSocket, cu fraze rapide), **General** (sala deschisă tuturor) și **Privados** (unu la unu, căutare după nume). General și privatele se citesc din API la fiecare 3 s cât panoul e deschis; cu panoul închis se verifică privatele la 30 s (insignă + notificare mică).
- Codul: `modules/chat/` (`filter.js` = filtrul de cuvinte, linkuri, emailuri, telefoane; `service.js` = toate regulile, în `CHAT`), `public/js/chat.js`, mesaj WebSocket `chat`.
- Limite: 200 de caractere; minim 1,5 s între mesaje, max. 6 la 30 s, fără același mesaj repetat într-un minut.
- Atingi un mesaj → **Mensaje privado**, **Reportar** (motiv), **Bloquear**. Blocatul nu-ți mai apare nicăieri și nu-ți poate scrie în privat. Oricine poate închide privatele din „Ajustes del chat”.
- 3 reportări de la persoane diferite ascund mesajul; cine are 3 mesaje ascunse în 7 zile nu poate scrie 24 h. În panoul de admin (`/admin`) există secțiunea „Chat: mensajes reportados” (fals aviz / ascunde / ascunde și reduce la tăcere 7 zile).
- Mesajele publice se șterg după 7 zile, cele private după 90 (`prune_chat`, la pornire și la fiecare 6 h). Tabele: `chat_messages`, `chat_reports`, `chat_blocks`, `chat_reads`.
## 5f. Eroi și niveluri (ramura `heroes`)

- Fiecare cont are **nivel** (1–50) și **XP**. XP din toate jocurile: Blitz 3/răspuns corect; Duel 40/25/15; Sală 50/35/25/15; Conquista 80/50/30; contra boților ×0,6; cucerirea unei țări +100, apărarea ei +20. Curba: de la nivelul n la n+1 trebuie 100 + 50·(n−1) XP. Totul în `modules/heroes/catalog.js`.
- **Eroul** (pagina `/heroe`): rasă (om, elf, pitic, orc) × clasă (războinic, mag, explorator) × sex = 24 de portrete în `public/img/heroes/<rasa>-<clasa>-<h|m>.webp` (generate cu ChatGPT, tăiate din 4 planșe). Conturile noi sunt duse la crearea eroului după login („Más tarde” sare peste). Prima creare e gratuită; schimbarea rasei/clasei/sexului costă 300 de monede (păstrează nivelul și echipamentul).
- **Echipament doar vizual** (nu dă avantaj la întrebări), deblocat pe niveluri: armură → rama portretului; armă → aura; emblemă → insigna; stindard → fundalul cărții; titlu → textul de sub nume. Fiecare piesă adaugă „putere” (poder) = nivel·20 + puterea pieselor.
- Rivalii văd eroul: în lista din sală, în ecranul „cara a cara” (VS) dinaintea duelului/sălii, la începutul Conquistei, în bara de scor și în clasamentul final. Boții primesc un erou aleator (nivel 1–15). La final apare „+XP”, iar la nivel nou, confetti și piesele deblocate.
- **Deblocări pe nivel** (`UNLOCKS` în catalog, verificate pe server cu `heroes.requireUnlock`): nivel 2 → scrii în chatul General; nivel 3 → mesaje private; nivel 5 → cumperi țări. Chatul din partidă e liber.

## 5g. Data nașterii și modul +18 „Conquista en pareja” (ramura `mas18`)

- **Data nașterii e obligatorie** (pagina `/edad`, cerută pe orice pagină cât timp lipsește). Se pune o singură dată și nu se mai poate schimba (doar din baza de date, la cerere). Nu pleacă niciodată de pe server: clientul primește doar `birthdateSet` și `adult`. **Sub 14 ani contul se șterge** (în Spania e nevoie de acordul părinților sub 14). Codul: `modules/players/age.js`.
- **Cadou de ziua ta: 500 de monede**, o dată pe an, când intră în ziua lui (`birthday_gift` în SQL; cei născuți pe 29 februarie îl primesc pe 28 în anii nebisecți).
- **Modul +18** la `/pareja` (nu apare în sitemap și e blocat în robots): Conquista pe harta Spaniei pentru **2 jucători** (4 runde de atac), doar cu întrebări +18 din `db/adult/choice.json` (~260) și `db/adult/numeric.json` (~60) — anatomie, sex (posturi, practici, jucării, fantezii, argou), sănătate sexuală, reproducere, istorie, cultură pop, curiozități. Nu se amestecă niciodată cu modurile normale.
- Se poate juca: **privat cu cod/link** (pentru partener), **cu altă persoană +18** (coadă; după 15 s intră un bot) sau, din așteptarea privată, **contra unui bot**. Serverul verifică `adult` la fiecare intrare. Cardul de pe prima pagină se vede doar pentru adulți. La prima intrare apare un avertisment de conținut explicit.
- Partidele se salvează cu `mode = 'conquista18'`, dau monede și XP, dar nu contează în clasamentul Conquista normal.

## 5h. Campania „Las Crónicas de Sapiencia” (ramura `lore`)

- Pagina `/campana` (card pe prima pagină). Poveste epică cu umor: lumea **Sapiencia**, unde cunoașterea e magie; răul e **El Olvido**, o ceață care mănâncă amintirile. Ghid: **Maestro Ulula** (bufnița din mascote). Textele sunt în `modules/campaign/story.js` (ușor de editat; `{nombre}` = numele jucătorului).
- Structură: **prolog pe rasă** (Alejandría Nueva · Bosque de las Mil Páginas · Forja de la Memoria · Estepas del Tambor), apoi **5 capitole comune** (Gran Biblioteca → Mar de la Duda → Ruinas del Tiempo → Torre de los Mil Inventos → Corazón del Olvido). Prologurile celorlalte rase se deschid ca „extra” după al tău. Fiecare capitol: scene → luptă → scenă → luptă → boss → final.
- Fiecare capitol folosește o categorie de întrebări (general, arte, ciencia, deportes, geografía, historia; finalul le amestecă).
- **Luptă**: 3 inimi contra vieții inamicului (3–6 la lupte, 5–10 la boși); 15 s pe întrebare; după fiecare răspuns se arată răspunsul corect. Totul se verifică pe server (`campaign_runs`).
- **Recompense la prima victorie**: luptă +30 XP +10 monede; boss +120 XP +50 monede + o piesă exclusivă de campanie (titluri pe rasă, stindard „Biblioteca”, aura „Marea”, emblema ⏳, armura mecanică); boss-ul final +400 XP +300 monede + aura „Filo del Olvido” și titlul „Vencedor del Olvido”. Progresul e în `players.campaign`.
- Imagini (ChatGPT): 9 boși, 9 scene de capitol, 4 „Desmemoriados” în `public/img/lore/`.

## 5i. Cont cu email și parolă (ramura `cuenta-email`)

- Pe lângă Google, în fereastra de login: **Entrar / Crear cuenta** cu email și parolă (+ „¿Has olvidado la contraseña?”). Codul: `modules/auth/local.js`, `password.js` (scrypt, fără dependențe), `mail.js` (Brevo).
- **Emailuri prin Brevo** (API HTTP): variabilele **`BREVO_API_KEY`** și **`MAIL_FROM`** (expeditorul verificat în Brevo). Cu ele: contul trebuie confirmat din link (48 h) și se poate reseta parola (link 1 h, închide celelalte sesiuni). **Fără ele**: contul se activează direct, fără confirmare și fără resetare (doar pentru teste).
- Pagina `/verificar` primește linkurile din emailuri (`#v=` confirmare, `#r=` parolă nouă).
- Siguranță: parolă min. 8 caractere (nu doar cifre, nu din cele banale); 5 încercări greșite → blocare 15 min; răspunsuri identice la „am uitat parola” fie că emailul există sau nu; tokenuri de unică folosință salvate ca hash.
- Dacă cineva intră cu Google cu același email ca un cont cu parolă, intră în **același cont** (Google a verificat emailul). Invers, un email deja folosit cu Google nu se poate înregistra cu parolă.

## 5j. Provocarea zilnică și seria de zile (ramura `reto-diario`)

- Pagina `/reto` (card pe prima pagină cu seria 🔥 și starea de azi). **10 întrebări, aceleași pentru toți** în ziua respectivă (ora Madridului; alese cu `daily_questions`, ordine fixă după dată), **o singură încercare pe zi**, 15 s pe întrebare. Puncte: 100 pe răspuns corect + 10 pe fiecare secundă rămasă.
- **Clasamentul zilei** (top 20 + locul tău) și **rezultat de distribuit** în stil Wordle (🟩🟥 + scor + loc).
- **Seria de zile** (`players.streak`, `streak_best`, `streak_day`): crește dacă joci în zile la rând; se rupe dacă sari o zi.
- **Recompense**: 10 monede + 3/răspuns corect + 5/zi de serie (max. 7) + bonus la 7 zile (+100), 30 (+500), 100 (+2000); XP 20 + 5/răspuns corect. Cifrele sunt în `modules/daily/service.js` (`DAILY`).
- Dacă cineva închide pagina în mijlocul unei întrebări și revine după ce a expirat timpul, întrebarea se numără greșită (nu se poate „trage cu ochiul” și reîncerca).

## 5k. Potrivire pe nivel și provocare prin link (ramura `emparejamiento`)

- **Rang de potrivire** = ELO de duel (cât de bine răspunzi) + 5 pe nivel de erou (cât joci, max. 40 niveluri). **Ranguri**: 🥉 Bronce <900 · 🥈 Plata · 🥇 Oro 1100+ · 🔷 Platino 1300+ · 💎 Diamante 1500+ · 👑 Maestro 1700+. Se văd în profil, pe cărțile VS și în ecranul de căutare. Codul: `modules/multiplayer/matchmaking.js` (`MM`).
- **Duel**: întâi caută rival cu diferență ≤100 puncte; fereastra crește cu 25/secundă; după 8 s acceptă pe oricine; după 12 s, bot **de nivelul tău** (boții sunt mai buni pentru rangurile mari). La fel pentru Conquista (grupuri de 3 cât mai apropiate; la expirarea timpului se completează cu boți de nivelul grupului). Cozile se reverifică în fiecare secundă.
- **Provocare prin link** („⚔️ Retar a un amigo” pe prima pagină → `/duelo?amigo=1`): duel privat, codul/linkul `/duelo?reto=COD` se trimite pe WhatsApp; începe când intră prietenul. **Nu schimbă ELO-ul** (ca să nu se poată „dărui” puncte). **Revanșă** când o cer amândoi.

## 5l. Grafica Conquistei și sunete (ramura `grafica-sonidos`)
- Harta e generată din nou din es-atlas, cu mai multe detalii (scriptul de generare nu e în repo; păstrează aceleași id-uri, centre și vecini). Aspect de „machetă”: spumă pe coastă, grosime maro sub regiuni, degradeuri pe culori, cifrele în insigne rotunde, turnurile castelului ca 3 scuturi aurii, ⚔️ pe regiunea atacată, regiunile de ales se ridică și strălucesc. Fără pătratul de la atingere (tap highlight).
- În partidă pagina ocupă tot ecranul, fără scroll: întrebarea stă într-o „foaie” peste partea de jos a hărții; harta se micșorează cât să încapă în spațiul rămas (acoperită cel mult ~45%).
- Sunete sintetizate în `fx.js`: tobe de război la începutul bătăliei, redoblare + săbii la fiecare luptă, corn când e rândul tău, fanfară la început, fanfară când cucerești, trompete triste când pierzi o regiune, castel care se prăbușește, scut la apărare, fanfară regală la victorie. Muzică medievală de lăută în meniu (prima pagină, așteptare, meniurile +18). Castele noi 3D (generate în ChatGPT, recolorate roșu/albastru/verde, `castillo-*.webp?v=2`), mai mari pe hartă, cu un halou în culoarea jucătorului. Butonul de sunet are 3 stări: 🎶 muzică + efecte → 🔊 doar efecte → 🔇.

## 5m. Conquista cu prietenii și liga săptămânală (ramura `amigos-liga`)
- **Conquista con amigos**: butonul „👥 Conquista con amigos” de pe prima pagină → `/conquista?amigos=1` creează o sală privată (cod `C…`); prietenii intră cu linkul `/conquista?c=COD`. Sala de așteptare arată cine a intrat; partida pornește singură când sunt 3, iar anfitrionul poate porni mai devreme (locurile goale le iau boți). Server: `privateCq` are acum `guests`, mesaje `cq_lobby` / `cq_lobby_closed`; dacă anfitrionul iese, sala se închide. Merge la fel pentru modul +18 (2 jucători).
- **Liga săptămânală** (`modules/weekly`): fiecare punct de experiență câștigat de luni până duminică (ora Madridului) contează (`add_week_points`, apelat din `heroes.addXp`). La începutul săptămânii următoare, primii 10 primesc monede: 1.000 / 600 / 400 / 150 (locurile 4–10). Plata e atomică și o singură dată (`pay_weekly_prizes`, tabelul `weekly_payouts`); serverul verifică la pornire și în fiecare oră. Pe prima pagină: cardul „🏆 Liga semanal” cu top 10, poziția ta, cât mai e până se închide și un mesaj de felicitare cu confetti când ai câștigat (`/api/weekly`, `/api/weekly/seen`).

## 5n. Domeniu propriu
- Site-ul e pe **https://www.yosoylisto.es** (domeniu cumpărat la IONOS). În IONOS: CNAME `www` → ținta dată de Railway + TXT `_railway-verify.www`; `yosoylisto.es` (fără www) are redirecționare HTTP 301 către `https://www.yosoylisto.es` (fără bifa „también para subdominios www”).
- Railway: domeniul custom `www.yosoylisto.es` pe portul 8080; `PUBLIC_URL = https://www.yosoylisto.es`. Google OAuth („Yo Soy Listo web”) are și redirect URI-ul `https://www.yosoylisto.es/auth/google/callback`.
- Adresa veche `*.up.railway.app` redirecționează 301 la domeniul nou (în afară de `/api/` și `/health`).

## 5o. Pagini SEO cu întrebări și răspunsuri + Search Console
- `/preguntas` (index), `/preguntas/<categorie>` (general, historia, geografia, ciencia, arte, deportes) și `/preguntas/<tema>` (para-ninos, faciles, dificiles, espana, historia-de-espana, capitales, futbol, animales, cine-y-series, musica, literatura, cuerpo-humano, espacio — filtre pe cuvinte în `THEMES`, apar doar dacă au ≥20 de întrebări): generate pe server din `db/questions/*.json` (`modules/seo/pages.js`), grupate pe dificultate, răspunsul în `<details>` (fără JS), canonical + meta description, buton „Jugar” spre Blitz pe categoria respectivă și spre Conquista. Sunt în sitemap și au link din footer.
- Google Search Console: proprietate de domeniu `yosoylisto.es` pe contul cristiancinzeaca@gmail.com, verificată cu TXT `google-site-verification=…` pe `@` în IONOS (nu se șterge). Sitemap trimis.

- Oct 2026: +10 teme noi (preguntas-trampa, halloween, navidad, mitologia, inventos, geografia-de-espana, historia-antigua, pintura, tecnologia, matematicas). Întrebările noi scrise pentru ele au un al 6-lea câmp `tag` în JSON (trampa/halloween/navidad/mitologia/inventos), pe care îl citesc doar paginile SEO; în joc intră ca orice întrebare. Titlurile au acum numărul de întrebări („200+ preguntas de arte… (fáciles y difíciles)”), iar H1 are numărul între paranteze.

## 5p. Panou admin: activitate
- În `/admin/` (cu `ADMIN_KEY`) e secțiunea **📊 Actividad**: jucători înregistrați (Google/correo), noi azi/7/30 zile, activi azi/7 zile, conectați acum (din serverul de partide, `core/live.js`), partide online pe mod (7 zile), Blitz, provocarea zilnică, grafic pe 14 zile, ultimii 500 de înregistrați (email mascat implicit, cu bifa „Mostrar correos completos” se vede întreg; căutare după nume sau email; nivel, partide, monede, „visto”) și ultimele 30 de partide online.
- Date: funcția SQL `admin_stats()` (ora Madridului), ruta `GET /api/admin/stats`. `last_seen_at` se actualizează la orice cerere cu sesiune, cel mult o dată la 10 minute per jucător (`touch` în `players/service.js`).

## 5q. Versiunea pentru CrazyGames (ramura `crazygames`)
- `/portal` (meniu: un buton „PLAY”, engleză/spaniolă) și `/portal/conquista` (aceeași pagină ca `/conquista`). Doar aceste pagini pot fi puse în iframe (`frame-ancestors 'self' https:`); restul site-ului rămâne `'none'`. `robots.txt` le exclude.
- Cont anonim de portal: `POST /api/players/portal {source:'crazygames'}` (coloana `players.portal_source`, `hasAccount` = true, fără e-mail și fără dată de naștere → fără +18). Primește monedele de bun venit.
- `public/js/i18n.js`: detectează portalul și limba (`?lang=` → ales înainte → browser). În engleză traduce interfața din mers (dicționar + modele, MutationObserver). Expune `YSL` (`portal`, `en`, `t()`, `home`, `notify()`); `notify` trimite `gameplayStart/Stop` și `loadingStart/Stop` către pagina-părinte.
- Conquista în engleză = varianta `en` din hub: întrebări din `db/en/choice.json` (378) și `db/en/numeric.json` (116), texte de eveniment în engleză (`ConquistaGame` cu `lang`), nume de regiuni în engleză (`NAMES_EN`), fără aliați, bot după 6 s.
- În portal: fără chat, fără linkuri către magazin sau profil, fără raportare de întrebări în engleză.
- SDK CrazyGames în pagina din zip: progres prin **Data Module** (`ysl:token` în cloud-ul lor; jocul îl primește în `#t=` și îl recuperează), **invitații** (`updateRoom` cu `inviteParams.room` = codul sălii, `inviteLink` pentru butonul „Invite friends”, `getInviteParam('room')` → `/portal?room=COD`, `addJoinRoomListener`), **isInstantMultiplayer** → `/portal?instant=1` (creează direct o sală). „Play again” într-o sală cu prieteni creează o sală nouă.
- `crazygames/index.html` = pagina care se urcă pe CrazyGames (zip): încarcă SDK-ul v3, alege limba (locale/countryCode) și pune `https://www.yosoylisto.es/portal` în iframe; transmite evenimentele către SDK.

## 5r. Aplicația de Android (ramura `android`)
- Trusted Web Activity (site-ul pe tot ecranul), pachet `es.yosoylisto.app`, în `android/` (androidbrowserhelper 2.5.0, AGP 8.11.1, compile/targetSdk 36, doar portret). Pornește pe `https://www.yosoylisto.es/?utm_source=android`.
- Se construiește în GitHub Actions (`.github/workflows/android.yml`, la push pe `android/**` sau manual) și ajunge în **Releases → `android-latest`**. Fără secrete iese doar un APK de test (semnat cu cheie de debug). Cu secretele `ANDROID_KEYSTORE_B64` și `ANDROID_KEYSTORE_PASSWORD` iese AAB semnat (pentru Google Play) + APK + amprenta SHA-256.
- `/.well-known/assetlinks.json`: amprentele din `ANDROID_CERTS` (în `core/server.js`) + variabila `ANDROID_CERT_SHA256` (adaugi amprenta cheii Google Play din Play Console → App integrity, separate prin virgulă).
- Cheia de upload: încă nu a fost pusă în GitHub (Cristian a ales „mai târziu”). Amprenta din `ANDROID_CERTS` e a unei chei generate de test; dacă la final se folosește altă cheie, se schimbă amprenta.
- Materiale Google Play (texte ES, iconiță, 1024x500, capturi) livrate în chat.
- Proxy-ul sesiunii nu permite API-ul GitHub Actions (nici secrete, nici rulări); Releases se pot citi.

## 6. Alte idei în așteptare

- **Monetizare** (când există trafic): Google AdSense + banner de cookie-uri (obligatoriu în UE) + pagina „Aviso legal” (cere numele și NIF-ul titularului).
- Mai multe întrebări și categorii (de exemplu „España”, cinema, muzică). Formatul e explicat în `README.md`.
- Aplicație pentru magazinele Android/iOS din același cod.

## 5s. Joc fără cont pe site + contor de vizite (oct. 2026)
- **Invitați web**: `Player.ensure()` creează un cont anonim (`POST /api/players/portal` cu `source: 'web'`, `portal_source='web'`, `guest_at`). `toPublic` dă `guest: true`, `portal: null`. Fără dată de naștere, fără chat (server: 403 la scris; raportare/blocare permise), fără +18.
- **Salvarea progresului**: `Player.nudgeSave(el)` („💾 Guardar mi progreso”) pe ecranele de final (Conquista, Blitz, duel/sală), pe prima pagină și în profil. Google (`guestToken` la `/api/auth/complete`) și înregistrarea cu email (`guestToken` la `/api/auth/register`) transformă ACELAȘI rând: se păstrează monedele, nu se mai dă bonusul de bun venit, `created: false`.
- **Navigatoare din aplicații** (TikTok, Instagram, Facebook): Google nu permite login acolo → butonul Google e ascuns, rămâne emailul + indicația „Abrir en el navegador”.
- **Cola**: așteptare 8 s (Conquista/duel), 4 s (portal), buton „▶️ Jugar ya” (`cq_now`), numărătoare inversă vie.
- **Prima pagină**: „▶️ Jugar ahora” + „👥 Reta a 2 amigos”. Final Conquista: „👥 Reta a tus amigos” → sală privată cu buton WhatsApp (`wa.me`).
- **Vizite** (`modules/visits`): fără cookies; numără GET-urile de pagini HTML (fără boți/fișiere), pe zi/origine/pagină; unicii cu amprentă zilnică doar în memorie (sare nouă în fiecare zi). Se scriu la 60 s cu `count_visits()` în tabela `visits`. Originea: `?utm_source=` / `?ref=`, altfel Referer (tiktok, google, instagram…), `directo`, `interno`.
- **Admin**: secțiunea „Embudo”: vizitatori unici → invitați → au jucat → revin → și-au salvat contul; tabele cu originea și paginile; barele pe zile au vizitatori și invitați.
- Linkul din bio TikTok: `https://www.yosoylisto.es/?utm_source=tiktok` (și `?utm_source=tiktok2` pentru al doilea cont), ca să știm de unde vin.

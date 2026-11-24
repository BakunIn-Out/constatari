# Constatări

Aplicație de telefon (web app / PWA) pentru constatările de pe șantier, la verificarea apartamentelor înainte de predare.
Faci o poză sau un video, spui ce e, alegi încăperea și salvezi. Restul îl pregătește aplicația pentru aplicația de verificări a echipei.

Merge pe Android și pe iPhone, direct din browser. Se poate pune pe ecranul principal ca o aplicație.

## Cum se folosește

1. **Unde ești?** Alegi din butoane mari: clădirea sau zona, etajul, apartamentul. Data viitoare, butonul „Continuă” te duce înapoi.
2. **Constatare nouă**
   - **Poză** sau **Video**. Video-ul (câteva secunde, ex. o ușă care nu se închide) devine pe telefon un GIF mic, care se vede animat.
   - **Apasă și vorbește** (dictare în română) sau scrie.
     Opțional, **Completează automat textul**: asistentul AI rescrie ce ai spus într-un rând scurt. Doar când apeși tu.
   - **Încăperea**: din lista apartamentului. Pentru altele, „Altă încăpere…”, cu căutare.
   - **Detalii** (opțional): specialitate, tip, prioritate, firmă, termen.
     După ce alegi specialitatea, apar întâi firmele care o fac de obicei. Restul sunt sub „Alte firme”.
   - **Salvează**.
3. **Constatările mele**: tot ce e pe telefon, pe apartamente, cu căutare și filtrul „De trimis”. Atingi una ca s-o schimbi sau s-o ștergi.
4. **Trimite constatările**
   - **Fișier pentru aplicația de verificări**: acolo, meniu → „Combina backup-uri”.
   - **Raport PDF** cu poze.
   - **Raport Excel**: același raport, cu pozele mici în celule, filtru pe coloane și foaia „Sumar”.

Constatarea începută nu se pierde dacă telefonul închide pagina (de exemplu cât e deschisă camera): o găsești la loc când revii.

## Pornire

Echipa primește un link cu codul echipei și îl deschide **o singură dată** pe telefon. Fără link, aplicația cere codul.

**Pe iPhone:** Safari → Partajează → **Adaugă pe ecranul principal**, apoi folosește aplicația de pe ecran. Safari și aplicația de pe ecran au memorii separate.

## Date și confidențialitate

- Constatările și pozele stau **pe telefon** (IndexedDB) până când le trimiți tu.
- Listele echipei (clădiri, etaje, apartamente, încăperi, specialități, firme) și cheia asistentului AI sunt în `date.bin.json`, **criptate** (AES-256-GCM, cheie derivată din codul echipei cu PBKDF2). Fără cod nu se pot citi.
- Spre asistentul AI (DeepSeek) pleacă doar textul și pozele constatării, doar când apeși „Completează automat textul”.
- În acest repository nu există nicio cheie, niciun cod și nicio dată în clar.

## Tehnic

- HTML + CSS + JavaScript simplu, fără framework și fără pas de build: `index.html`, `app.js`, `style.css`.
- `sw.js` (service worker): aplicația se deschide și fără semnal. Fișierele au versiunea în adresă (`?v=`), iar o versiune veche rămasă în browser se repară singură.
- IndexedDB: depozitul `obs` (constatările, fără pozele mari), `poze` (pozele, citite doar la deschidere / trimitere) și `draft` (constatarea începută).
- Video → GIF direct pe telefon, cu [gifenc](https://github.com/mattdesl/gifenc) (MIT), în `lib/`.
- Testele automate (Edge și Firefox cu ecran de telefon) rulează local; nu fac parte din acest repository.

---

crafted by [0xhuo](https://0xhuo.dev)

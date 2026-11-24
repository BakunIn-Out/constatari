# Constatări

Aplicație web (PWA) pentru constatări pe teren, pe telefon (Android și iPhone):

1. **Poză sau video.** Video-ul (câteva secunde, ex. o ușă care nu se închide) devine un GIF mic, direct pe telefon.
2. **Spune ce vezi.** Dictare în română. Opțional, asistentul AI (DeepSeek) scrie rândul scurt și alege încăperea, specialitatea și tipul. Tu doar verifici.
3. **Salvează.** La final: fișier pentru „Combina backup-uri” din aplicația de verificări, raport PDF sau tabel CSV.

- Datele stau pe telefon (IndexedDB) până la export. Constatarea începută se păstrează și dacă pagina se închide.
- Spre AI pleacă doar textul și imaginile constatării, doar când completează. Cheia DeepSeek se pune în Setări și rămâne pe acel telefon.
- Listele (locații, etaje, apartamente, încăperi, firme) se importă din backup-ul aplicației de verificări (Setări).
- Fără chei sau date în acest repository.

Encoder GIF: [gifenc](https://github.com/mattdesl/gifenc) (MIT), în `lib/`.

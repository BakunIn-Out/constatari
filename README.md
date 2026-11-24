# Constatări

Aplicație web (PWA) pentru constatări pe teren, pe telefon (Android și iPhone):

1. **Poză sau video.** Video-ul (câteva secunde, ex. o ușă care nu se închide) devine un GIF mic, direct pe telefon.
2. **Spune ce vezi.** Dictare în română; asistentul AI (DeepSeek) scrie rândul scurt și alege încăperea, specialitatea, tipul și firma. Tu doar verifici.
3. **Salvează.** La final: fișier pentru „Combina backup-uri” din aplicația de verificări, raport PDF sau tabel CSV.

- Datele stau pe telefon (IndexedDB) până la export. Constatarea începută se păstrează și dacă pagina se închide.
- Spre AI pleacă doar textul și imaginile constatării, doar când completează. Asistentul e pornit pentru toată echipa.
- Clădirile, etajele, apartamentele, încăperile și firmele + cheia asistentului stau în `date.bin.json`, criptate (AES-GCM). Aplicația se deschide cu linkul echipei; fără el nu se vede nimic.
- Nicio cheie și nicio dată în clar în acest repository.

Encoder GIF: [gifenc](https://github.com/mattdesl/gifenc) (MIT), în `lib/`.

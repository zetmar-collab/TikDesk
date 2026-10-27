# Changelog

## 1.3.0 — 2026-10-27

- Naprawiono przywracanie widoku po błędzie podczas używania Wstecz/Dalej oraz skróty w lokalnym interfejsie.
- Pobieranie jest anulowalne, ma limity czasu i sprawdza strukturę MP4 przed zastąpieniem wybranego pliku.
- Dodano panel pobrań z historią, ponawianiem i otwieraniem plików/folderów; zamknięcie podczas pobierania wymaga decyzji.
- Kopiowanie linku dotyczy oglądanego filmu, a nie adresu feedu.
- Dodano folder pobierania, ustawienia startu, zakładki i ręczne sprawdzanie aktualizacji GitHub.
- Naprawiono synchronizację systemowego motywu TikToka i rozszerzono testy przywracania ustawień.
- Rozdzielono obsługę transferu, walidacji pliku, sieci, skrótów i aktualizacji na moduły; dodano workflow testów Windows.

## 1.2.0 — 2026-10-25

- Widoczny pasek z podpisanymi przyciskami Wstecz, Dalej, Ekran główny i Odśwież.
- Wybór motywu Ciemny/Jasny/Systemowy dla interfejsu aplikacji i preferencji TikToka.
- Zapamiętywanie motywu, widoku, wyciszenia, rozmiaru okna i maksymalizacji; migracja ustawień wersji 1.1.
- Zapis ustawień oraz cookies przy zamknięciu, synchronizacja ręcznej zmiany motywu w menu TikToka.
- Test historii nawigacji i test ustawień przez zamknięcie oraz ponowne uruchomienie procesu.

## 1.1.0 — 2026-10-25

- Przycisk „Pobierz” dla aktualnie widocznego filmu, okno zapisu MP4, postęp i anulowanie.
- Rozpoznawanie źródła w standardowym odtwarzaczu oraz odtwarzaczu MediaSource TikToka.
- Komunikaty wyniku w lewym panelu oraz odrzucanie odpowiedzi HTML/JSON zamiast zapisywania ich jako filmu.
- Testy wyboru filmu, adresów CDN i faktycznego pobierania z TikToka.

## 1.0.0 — 2026-10-25

- Pierwsza wersja nieoficjalnej przeglądarki TikTok WWW dla Windows x64.
- Polski interfejs, widok telefonu i WWW, logowanie na stronie i trwała lokalna sesja.
- Skróty do feedu, LIVE i przesyłania; historia, odświeżanie, kopiowanie linku, wyciszanie i pełny ekran.
- Izolowany renderer TikToka, walidacja domen i IPC, pytania o uprawnienia oraz usuwanie lokalnej sesji.
- Testy reguł bezpieczeństwa i integracji Electron, instalator NSIS.

Ograniczenie: funkcje pochodzą z TikTok WWW, bez pełnej zgodności z Android/iOS.

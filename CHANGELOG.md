# Changelog

## 1.4.0 — 2026-11-17

- Naprawiono anulowanie i limit czasu przygotowania filmu oraz ograniczono oczekiwanie przy zamykaniu aplikacji.
- Walidator MP4 wymaga prawidłowej hierarchii ścieżki wideo, nagłówków i opisu próbek; nie nadpisuje pliku po odrzuceniu.
- Aktywne pobrania i własne ścieżki tymczasowe są zapisywane przed transferem; po awarii można ponowić zadanie lub potwierdzić usunięcie częściowego pliku.
- Dodano limit transferu 2 GB / 30 minut i kontrolę wolnego miejsca; logowanie pozostaje dostępne w małym oknie.
- Ograniczono kolejkę odczytu metadanych, naprawiono domeny cookies motywu i komunikaty błędów zapisu ustawień.
- Dodano wyszukiwanie, filtry i sortowanie bibliotek, usuwanie wpisów historii i rozpoznawanie brakujących plików.
- Dodano zakładkę oglądanego filmu oraz import/eksport zakładek JSON z walidacją i podglądem liczby duplikatów.
- Dodano trwałą kolejkę do 50 zadań, uruchamianą ręcznie, z pauzą i anulowaniem pojedynczych zadań. Po restarcie kolejka czeka na Start.
- Dodano diagnostykę bez cookies/linków/prywatnych ścieżek, osobne zgody na kamerę i mikrofon, cofanie zgód oraz pomiar i czyszczenie cache.
- Dodano konfigurowalne skróty z wykrywaniem konfliktów i przywracaniem ustawień domyślnych.
- Pobieranie uwzględnia systemowy/PAC proxy HTTP/HTTPS Chromium; SOCKS i uwierzytelnienie proxy pozostają poza zakresem.
- Usunięto alert minimatch przez nadpisanie wyłącznie podatnych wersji; dodano lint, stopniowe sprawdzanie typów, test awarii procesu i kontrolę paczki.
- Przeniesiono pełny harness testów Electron do scripts/ poza paczkę produkcyjną; CI rozszerzono o build, instalację/deinstalację w jednorazowym środowisku i raporty.

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

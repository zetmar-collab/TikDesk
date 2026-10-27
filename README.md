# TikDesk

Nieoficjalna aplikacja dla Windows 10/11 x64, otwierająca **stronę TikToka** w widoku telefonu lub w trybie WWW. Nie jest aplikacją Android/iOS i nie zapewnia wszystkich funkcji mobilnego TikToka.

Bieżąca wersja: **1.3.0**, instalator: `TikDesk-Setup-1.3.0.exe`.

[Pobierz instalator Windows 1.3.0](https://github.com/zetmar-collab/TikDesk/releases/download/v1.3.0/TikDesk-Setup-1.3.0.exe) · [Wszystkie wydania](https://github.com/zetmar-collab/TikDesk/releases)

## Instalacja i używanie

1. Pobierz instalator z wydania powyżej, uruchom `TikDesk-Setup-1.3.0.exe` i wybierz katalog instalacji. Instalacja jest dla bieżącego użytkownika i nie wymaga administratora.
2. Uruchom TikDesk ze skrótu na pulpicie lub menu Start.
3. Kliknij **Zaloguj się**. Logowanie odbywa się na oficjalnej stronie `https://www.tiktok.com/login` wewnątrz aplikacji, w trybie WWW. Wybierz jedną z metod dostępnych na stronie, np. kod QR lub adres e-mail. TikDesk nie udostępnia własnego formularza hasła.
4. Po zalogowaniu kliknij **Telefon**, aby wrócić do mobilnego rozmiaru i identyfikacji przeglądarki. Sesja pozostaje w tej samej partycji Chromium.
5. **Prześlij film** otwiera stronę TikTok Studio w trybie WWW. Wybierasz plik i zatwierdzasz publikację na stronie TikToka.

Instalator nie ma podpisu Authenticode. Windows może wyświetlić ostrzeżenie SmartScreen. Do wydania dołączono plik z sumą SHA-256 instalatora.

### Funkcje i rzeczywiste ograniczenia

| Obszar | Obsługa |
| --- | --- |
| Mobilny widok | Wąski viewport, emulacja ekranu mobilnego Chromium i Android User-Agent. TikTok sam wybiera zwracany interfejs. |
| Konto | Oficjalne logowanie WWW, lokalna trwała sesja; wymaga sprawdzenia z kontem użytkownika. |
| Filmy, polubienia, komentarze, obserwowanie | Przez interfejs strony, gdy TikTok udostępnia je danemu kontu i regionowi. |
| LIVE i wiadomości | Tylko funkcje udostępnione przez TikTok WWW. Dostęp zależy od konta i regionu. |
| Przesyłanie | Link do TikTok Studio; strona odpowiada za obsługę formatów i publikację. |
| Aparat, mikrofon, powiadomienia | Uprawnienia po pytaniu użytkownika, jeśli strona w ogóle ich zażąda. Nie dodaje to funkcji mobilnych. |
| Mobilny edytor, efekty AR, duety, szkice z telefonu | Brak gwarancji obsługi. TikDesk ich nie implementuje i nie synchronizuje prywatnych danych aplikacji mobilnej. |
| Google / Apple / Facebook | Osadzone okna logowania; dostawca może odmówić logowania w osadzonej przeglądarce. Wybierz inną metodę na stronie TikToka. |
| Zewnętrzna przeglądarka | Otwiera link po potwierdzeniu. Sesja przeglądarki nie jest importowana do TikDesk. |
| Pobieranie | Przycisk **↓ Pobierz** zapisuje MP4 aktualnie widocznego filmu, jeśli odtwarzacz udostępnia jego plik. Wybór katalogu, postęp i anulowanie. |

Jeśli TikTok w widoku telefonu wymusza instalację aplikacji, użyj **WWW**. Sama zmiana User-Agent nie odtwarza Androida, nie gwarantuje mobilnego interfejsu i nie omija ograniczeń TikToka. Pełna aplikacja mobilna wymaga osobnego środowiska Android i oficjalnej aplikacji; ten projekt takiego środowiska nie zawiera.

### Sterowanie

- Pasek nad filmem: **← Wstecz**, **Dalej →**, **⌂ Ekran główny**, **↻ Odśwież**. Historia dotyczy stron/profili, a nie przewijania filmów w tym samym feedzie. Przyciski Wstecz/Dalej są nieaktywne, gdy nie ma odpowiedniej pozycji historii.
- **Motyw** na tym samym pasku: **Ciemny / Jasny / Systemowy**. Wybór obejmuje interfejs TikDesk i preferencję kolorów strony TikToka; zmiana odświeża stronę, aby zastosować motyw w komponentach serwisu. Ustawienie jest zapisywane automatycznie. Poszczególne widoki TikToka mogą mieć własny wygląd.
- Aplikacja pamięta tryb Telefon/WWW, motyw, wyciszenie, rozmiar okna i maksymalizację. Sesja konta oraz dane strony pozostają w tej samej partycji Chromium. Zmiana ciemnego/jasnego motywu w menu TikToka jest odczytywana z jego plików cookie i zapisywana jako preferencja aplikacji.

- Kółko myszy / touchpad: przewijanie strony.
- F5 / Ctrl+R: odświeżenie; F11: pełny ekran; Alt+←: wstecz; Alt+→: dalej; Alt+Home: ekran główny. Skróty działają także po kliknięciu przycisków interfejsu TikDesk.
- Kliknięcie adresu w dolnym pasku: otwarcie linku TikToka.
- Ikona kopiowania: kopiuje link do oglądanego filmu zamiast adresu feedu; nuta: wycisza dźwięk. Jeśli odtwarzacz nie podaje identyfikatora, otwórz szczegóły filmu.
- **↓ Pobierz** (prawy górny róg): wybiera film widoczny w chwili kliknięcia i otwiera okno zapisu MP4. Nazwa zawiera ID filmu, jeśli jest dostępne, lub czas kliknięcia. Możesz dalej przewijać — rozpoczęte pobieranie dotyczy wcześniej wybranego filmu. Przycisk pokazuje postęp, obok pojawia się **Anuluj**. Wynik zapisu jest widoczny w lewym panelu.
- **Usuń lokalną sesję**: po potwierdzeniu usuwa cookies, pamięć strony i cache, zamyka okna logowania oraz wylogowuje lokalnie.
- **Pobrane filmy**: lokalna historia do 100 pozycji z postępem, wynikiem zapisu, przyciskami Otwórz/Pokaż w folderze i ponowną próbą. Ponowienie otwiera zapisany materiał i sprawdza jego ID — nie pobiera innego filmu, jeśli serwis przekieruje na feed. Zamknięcie podczas pobierania wymaga wyboru Zostań albo Anuluj pobieranie i zamknij.
- **Ustawienia**: wybór folderu pobierania oraz ekranu głównego lub ostatniej strony po uruchomieniu. Folder wybrany w oknie zapisu jest również zapamiętywany. Przycisk Sprawdź aktualizacje odczytuje najnowsze stabilne wydanie z publicznego GitHub; instalację wykonujesz ręcznie.
- **Zakładki**: dodawanie aktualnego profilu lub strony, otwieranie i usuwanie. Limit 100 lokalnych zakładek. Dane nie są synchronizowane z kontem TikTok.

## Rozwój

Wymagane Node.js 22.12+ i npm (CI używa Node 24). Z katalogu projektu:

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
npm.cmd run test:smoke
npm.cmd run test:smoke -- --live
npm.cmd run build
```

`npm ci` pobiera Electron. Build pobiera narzędzia NSIS; potrzebny jest internet. Opcjonalnie `powershell -File scripts/make-icon.ps1` odtwarza własną ikonę aplikacji bez znaków TikToka.

## Architektura

Wybrano Electron zamiast domyślnego Tauri, aby dostarczać konkretną wersję Chromium i korzystać z jego emulacji mobilnego viewportu oraz osobnych sesji. Koszt: większy pakiet i zużycie zasobów; wydajność wymaga pomiarów na docelowym sprzęcie. Powłoka ma mały interfejs w HTML/CSS/JS bez dodatkowego frameworka i procesu bundlera.

```text
Lokalny interfejs HTML/CSS/JS (sandbox + CSP)
  -> preload: ograniczone command / onState
    -> main: walidacja nadawcy IPC, poleceń i adresów
      -> WebContentsView: HTTPS TikTok, sandbox, bez Node i bez preload
      -> okna logowania: ta sama sesja, ścisła lista domen
      -> Chromium persist:tikdesk: cookies / storage
      -> preferences.json: wygląd, widok, start, folder, okno
      -> downloads.json / bookmarks.json: lokalne biblioteki
      -> DownloadManager: strumień HTTPS -> plik tymczasowy -> walidacja -> zapis
```

```text
src/main.cjs        cykl życia, sesja, nawigacja, uprawnienia, test integracyjny
src/policy.cjs      reguły domen i obliczanie rozmiaru widoku
src/video.cjs       wybór widocznego filmu i walidacja adresów mediów
src/downloads.cjs   pobieranie, anulowanie, limity czasu i historia
src/mp4.cjs         sprawdzanie struktury MP4 oraz obecności ścieżki wideo
src/network.cjs     pobieranie strumieniowe z cookies dla docelowej domeny CDN
src/shortcuts.cjs   wspólne polecenia klawiaturowe
src/updates.cjs     odczyt stabilnego wydania GitHub i porównanie wersji
src/preferences.cjs walidacja ustawień i migracja poprzedniej wersji
src/theme.cjs       motyw i pliki cookie preferencji wyglądu TikToka
src/preload.cjs     wąski most IPC lokalnego interfejsu
src/renderer.js     obsługa interfejsu
src/index.html     polskie widoki i pomoc
src/styles.css     styl interfejsu
src/panels.css     biblioteki, ustawienia i responsywny panel boczny
tests/             testy granic domen i layoutu
scripts/           generator ikony
assets/            własna ikona
artifacts/         raporty i zrzuty testów (generowane)
dist/              instalator i aplikacja (generowane)
```

### Dane i lokalne API

Nie ma serwera, publicznego API ani własnej bazy kont. Cookies i dane strony obsługuje Chromium w `%APPDATA%/TikDesk/Partitions/tikdesk`. Nie logujemy haseł ani cookies konta. Profil zawiera wrażliwą sesję konta — dostęp do niego należy chronić jak do profilu przeglądarki. `preferences.json` ma schemat `{ "mode": "mobile" | "desktop", "theme": "dark" | "light" | "system", "muted": boolean, "window": { "width": number, "height": number, "maximized": boolean } }` i jest zapisywany atomowo. Wersja 1.2 odczytuje wcześniejszy plik ustawień, zachowuje widok i pobiera istniejący motyw z cookies TikToka. Przy zamykaniu kończy zapis ustawień i opróżnia bufor plików cookie. Usunięcie sesji usuwa konto lokalnie, ale zachowuje ustawienia aplikacji.

Most `window.tikdesk` istnieje wyłącznie w lokalnym interfejsie. `command(name, value)` zwraca `{ok, error?}`; `onState(callback)` przekazuje aktualny tryb, URL, stan ładowania, błąd, historię i wyciszenie. Proces główny sprawdza nadawcę i główną ramkę lokalnego dokumentu. Zdalna strona nie ma mostu do systemu. Dowolne linki zewnętrzne wymagają potwierdzenia i muszą mieć schemat HTTPS. Nie wyłączamy weryfikacji TLS, webSecurity ani CSP TikToka.

Wersja 1.3 rozszerza `preferences.json` o `downloadDirectory`, `startup` (`home`/`last`) i `lastUrl`. `downloads.json` przechowuje ścieżkę pliku, publiczny adres strony, ID filmu i wynik pobrania; nie zapisuje podpisanych adresów CDN ani cookies. `bookmarks.json` przechowuje ID, tytuł i adres strony. Dane pozostają lokalne, również po aktualizacji. Usuwanie zakładki usuwa tylko wpis; aplikacja nie usuwa pobranych filmów z dysku.

### Weryfikacja

`npm test` sprawdza m.in. podszywające się domeny, protokoły wykonujące kod, adresy z poświadczeniami, listę dostawców logowania i rozmiary widoku. `test:smoke` uruchamia prawdziwy Electron z oddzielnym tymczasowym profilem, sprawdza IPC, brak Node/mostu w zdalnym rendererze, szerokość viewportu, zmianę trybu, widoczność dialogów i ekran błędu. Zapisuje raport do `artifacts/` i próbuje zapisać zrzuty. Jeśli Windows uniemożliwi przechwycenie obrazu (np. `UnknownVizError`), raport zawiera `screenshotWarnings`; zaliczone testy funkcjonalne nie oznaczają wówczas sprawdzenia wyglądu. `--live` dodatkowo próbuje otworzyć prawdziwy TikTok i zapisuje wynik dostępu; blokada serwisu nie jest dowodem działania funkcji konta.

Ręczny odbiór na koncie: logowanie i ponowny start, feed i odtwarzanie z dźwiękiem, komentarz/polubienie, powrót do trybu Telefon, wybór pliku bez publikacji, odmowa uprawnienia aparatu, wylogowanie przez usunięcie sesji. Te testy wymagają udziału właściciela konta. Aktualizacja Electron i testy z TikTokiem są potrzebne przed kolejnymi wydaniami.

`npm.cmd run test:preferences` uruchamia aplikację cztery razy w tym samym odrębnym profilu testowym. Sprawdza ustawienia, folder, zakładkę, motyw ręczny oraz systemowy zmieniany tuż przed zamknięciem. Test integracyjny obejmuje także powrót z błędu przez historię, skróty lokalnego okna, ustawienia startu i ostrzeżenie przy zamknięciu. Integracja motywu korzysta z obecnych cookies `tiktok_webapp_theme` i `tiktok_webapp_theme_source`; po zmianach serwisu może wymagać dostosowania. [Pomoc TikToka: tryb ciemny](https://support.tiktok.com/pl/account-and-privacy/account-privacy-settings/dark-mode).

### Pobieranie — szczegóły i test

Rozpoznawanie filmu opiera się na widoczności odtwarzacza w oknie. W przypadku adresów `blob:` aplikacja odczytuje dane wyłącznie z komponentów React należących do wybranego odtwarzacza; nie wybiera losowego pliku z historii żądań ani innego filmu w feedzie. To zależy od aktualnej budowy strony TikToka i może wymagać aktualizacji po zmianach serwisu. Przycisk Pobierz wykorzystuje strumień HTTPS Node.js z User-Agent, Referer i cookies pobranymi wyłącznie dla docelowej domeny z sesji Chromium. Nie wyłącza weryfikacji TLS. Nie jest sprawdzony w środowisku wymagającym firmowego proxy systemowego.

Każdy adres i przekierowanie musi pozostać HTTPS w obsługiwanych domenach CDN TikToka. Limit na odpowiedź serwera to 30 sekund, a na kolejną porcję danych — 45 sekund; anulowanie przerywa połączenie. Film trafia do nowego katalogu tymczasowego obok wybranego pliku. Przed zastąpieniem pliku docelowego aplikacja sprawdza granice kontenerów ISO BMFF, `ftyp`, `moov`, `mdat` i ścieżkę `vide`. To kontrola struktury, a nie pełne dekodowanie wszystkich klatek. Błąd lub anulowanie usuwa plik tymczasowy i zachowuje wcześniejszy plik docelowy. Nie stosujemy zewnętrznych serwisów pobierania ani nie usuwamy znaków wodnych.

`npm.cmd run test:smoke -- --live --download-live` dodatkowo pobiera aktualny film z TikToka do `artifacts/download-mobile.mp4` i sprawdza rozmiar oraz nagłówek MP4. Flaga `--desktop-live` wybiera widok WWW i plik `artifacts/download-desktop.mp4`. Te opcje działają w osobnym profilu testowym. Przypadki jednostkowe obejmują wybór aktywnego filmu, odtwarzacz poza ekranem, dopasowanie metadanych, gałąź React po przewinięciu oraz złośliwe domeny i nazwy plików.

### Publikacja i dalsze prace

Instalator NSIS dla Windows x64 jest wynikiem `npm run build`. Sprawdzanie aktualizacji odczytuje publiczny endpoint wydań GitHub bez tokena; nie pobiera ani nie uruchamia nowego instalatora automatycznie. Wydania instaluje się ręcznie. Workflow `.github/workflows/checks.yml` uruchamia testy na Windows po wysłaniu zmian na GitHub; sam plik workflow nie oznacza, że CI już się wykonało.

Podpis Authenticode wymaga certyfikatu wydawcy. Domyślne wydanie pozostaje niepodpisane. Po skonfigurowaniu własnego certyfikatu dla electron-builder trzeba również nadpisać `win.signExecutable=true`, np. opcją `-c.win.signExecutable=true`. Nie zapisuj certyfikatu ani jego hasła w repozytorium. Przed publicznym wydaniem sprawdź instalację/deinstalację na czystej maszynie.

Dokumentacja techniczna: [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [emulacja urządzenia](https://www.electronjs.org/docs/latest/api/web-contents#contentsenabledeviceemulationparameters), [bezpieczeństwo Electron](https://www.electronjs.org/docs/latest/tutorial/security). Przykład funkcji mobilnej: [TikTok Mobile Effect Editor](https://effecthouse.tiktok.com/learn/guides/tutorials/mobile/mobile-effect-editor).

TikDesk nie jest powiązany z TikTok ani ByteDance. Kod projektu objęty MIT; serwis, filmy i znaki TikToka nie są objęte tą licencją.

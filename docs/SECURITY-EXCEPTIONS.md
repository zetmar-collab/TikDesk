# Tymczasowy wyjątek audytu — 17 listopada 2026

Aktualizacja bazy advisory podczas publikacji ujawniła [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), ReDoS w picomatch do wersji 4.0.7. Na dzień sprawdzenia nie było opublikowanej poprawionej wersji. Pełny npm audit zgłasza 9 alertów wysokich w jednym łańcuchu narzędzi budowania. Wcześniejszy lokalny wynik 0 alertów opisuje stan wcześniejszego sprawdzenia i nie jest bieżącym wynikiem.

Ścieżka: electron-builder → app-builder-lib → @electron/rebuild → node-gyp → tinyglobby/fdir → picomatch. To zależności deweloperskie. Picomatch nie znajduje się w paczce aplikacji. W przejrzanym node-gyp używane wzorce to stałe `build/*.sln` i `build/*.mk`, nie dane pobierane z TikToka. To ocena ekspozycji tego projektu, nie twierdzenie o usunięciu podatności biblioteki.

Wprowadzono jawny wyjątek do 17 grudnia 2026, bez wyłączania audytu. `npm run audit:security` akceptuje wyłącznie ten advisory, wyłącznie w zależnościach oznaczonych jako dev i przy picomatch 4.0.7. Każdy inny alert, obecność tej biblioteki w zależnościach produkcyjnych, nieprawidłowy raport lub upływ terminu powoduje błąd CI. Pełny raport pozostaje artefaktem. Zwykłe `npm audit` nadal zgłasza alerty — nie zostały ukryte ani uznane za naprawione.

Po opublikowaniu poprawki należy zaktualizować zależność, usunąć wyjątek i ponownie wykonać audyt oraz build. Nie obniżano wersji electron-builder tylko po to, aby zmienić wynik raportu. Pozostałe zabezpieczenia oraz naprawa minimatch pozostają aktywne.

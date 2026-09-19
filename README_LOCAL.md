# README_LOCAL.md — локальная сборка Termix (форк)

Документ описывает **только эту локальную сборку**: что было сломано в исходном
проекте, что именно здесь исправлено, как пересобрать и как кастомизировать.
Всё, что написано про проблемы — проверенные на этой машине факты, а не
предположения.

Проект не наш: исходники склонированы с GitHub, ничего обратно не отправляется.

| Параметр                    | Значение                                                   |
| --------------------------- | ---------------------------------------------------------- |
| Upstream                    | https://github.com/Termix-SSH/Termix (`main`)              |
| Коммит клона                | `9c04860` (18.09.2026, `chore: sync Crowdin translations`) |
| Версия проекта              | 2.7.1                                                      |
| Electron / electron-builder | 43.4.1 / 26.15.3                                           |
| node-pty                    | 1.1.0                                                      |
| Сборка на                   | macOS 27.0, arm64 (Xcode 26.6, Node v24.16.0, npm 12.0.2)  |

---

## 1. Где что лежит (важно не путать)

| Путь                                                                    | Что это                                                                                                     | Нужен?                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `/Users/aleksandrhohon/Desktop/development_locall/termix`               | **клон исходников** (1,6 ГБ: `node_modules`, `release`, `dist`)                                             | Да — для пересборки и правок кода |
| `/Applications/Termix.app`                                              | **установленное приложение** (собрано из клона, ad-hoc подписано)                                           | Да — этим пользуемся              |
| `~/Library/Application Support/termix`                                  | **данные приложения**: `server-data/db.sqlite.encrypted` (хосты, ключи), `termix-main.log`, сессии, uploads | Да — это твои данные              |
| `~/Library/Application Support/Termix`                                  | **тот же самый каталог**: APFS не различает регистр, inode совпадает (`79982564`)                           | Это не «остатки» и не дубликат    |
| `~/Library/Caches/Homebrew/downloads/…--termix_macos_universal_dmg.dmg` | единственный остаток от удалённой brew-версии (скачанный образ в кэше Homebrew)                             | Не нужен, можно удалить           |

Дополнительно: `release/mac-arm64/Termix.app` внутри клона — «черновик» сборки,
из которого приложение копируется в `/Applications`. Оба `.app` существуют
одновременно, это нормально.

**Разные вещи с одинаковым именем:** `termix` в клоне на Рабочем столе — это
исходный код; `termix` в `~/Library/Application Support/` — это данные
приложения. Общего между ними ничего, кроме имени.

**Как запускать приложение:**

```bash
open -a Termix          # или иконка в Launchpad/Dock
```

Клон для запуска **не нужен**. Он нужен только для пересборки: если его удалить,
приложение продолжит работать (вся нативная часть лежит внутри `.app`), но
пропадёт возможность править код и пересобирать.

---

## 2. Исходная проблема

Симптом:

```
Error invoking remote method 'local-terminal-start': Error: posix_spawnp failed.
```

Локальный терминал не открывался вообще, при том что SSH-хосты работали.
Сообщение вводит в заблуждение: `posix_spawnp` в большинстве случаев даже не
вызывался — это зашитая строка на любую ошибку.

### 2.1. Причина №1 (главная): `spawn-helper` без флага исполнения

Начиная с node-pty 1.1.0 на macOS рабочий процесс запускается не через
`forkpty()`, а через внешний бинарник `spawn-helper` (схема `posix_spawn` +
helper). В npm-посылке (и в Homebrew-пакете) этот файл распаковывается с
правами `0644` — npm срезает exec-бит у всего, что не объявлено в `bin`.
Проверено напрямую:

```
$ node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper /tmp /bin/echo test
exit=126
/bin/bash: …/spawn-helper: Permission denied
```

Далее `posix_spawn()` возвращает `EACCES`, а node-pty печатает зашитую строку
`"posix_spawnp failed."` — без причины и без errno.

### 2.2. Причина №2: `helperPath` указывал внутрь asar-архива

`lib/unixTerminal.js` (node-pty) вычисляет путь к helper так:

```js
helperPath = helperPath.replace("app.asar", "app.asar.unpacked");
```

В упакованном приложении архив называется `app-arm64.asar` (в
`electron-builder.json` стоит `mergeASARs: false`), поэтому подстрока
`app.asar` не находится, замена не срабатывает, и в `posix_spawn()` уходит путь
вида `…/Resources/app-arm64.asar/node_modules/node-pty/build/Release/spawn-helper`.
Asar — виртуальная ФС уровня Electron; системный `posix_spawn` её не видит →
`ENOENT`.

### 2.3. Причина №3: `spawn-helper` падал с SIGSEGV

Исходный `src/unix/spawn-helper.cc`:

```c
char *slave_path = ttyname(STDIN_FILENO);
close(open(slave_path, O_RDWR));   /* slave_path может быть NULL → SIGSEGV */
```

Если stdin не является pty, `ttyname()` возвращает `NULL`, а `open(NULL)` роняет
процесс. Подтверждено краш-репортом
`~/Library/Logs/DiagnosticReports/spawn-helper-2026-09-19-162800.ips`:

```
"exception": {"type":"EXC_BAD_ACCESS","signal":"SIGSEGV",
              "subtype":"KERN_INVALID_ADDRESS at 0x0000000000000000"}
"frames": [{"imageOffset":1484,"symbol":"main","symbolLocation":44}, …]
"procPath": "…/app-arm64.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper"
```

### 2.4. Причина №4: `errno` не доходил до вызывающего кода

В `src/unix/pty.cc`, функция `pty_posix_spawn()`: при любой ранней ошибке
(`posix_openpt`, `grantpt`/`unlockpt`, `ioctl(TIOCPTYGNAME)`, `open(slave)`,
`tcsetattr`) выполняется `return`, но `*err` не заполняется. Вызывающий код
инициализирует его как `int err = -1;`, поэтому любая из этих ошибок выводится
как `posix_spawnp failed.` — реальная причина полностью теряется.

### 2.5. Сопутствующие проблемы сборочного окружения

| Симптом                                                             | Причина                                                                                                                                             | Закрыто                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `gyp: buildcheck.gypi not found` на `cpu-features`, падала упаковка | её install-скрипт `node buildcheck.js > buildcheck.gypi && node-gyp rebuild` выполнялся частично (npm 12 запускал только `node-gyp rebuild`)        | генерация `buildcheck.gypi` в `scripts/patch-nan.cjs`                       |
| `ld: unknown architecture arm64e.x1-macos`                          | `xcrun --show-sdk-path` отдавал SDK macOS 27.0 из Command Line Tools, а clang брался из Xcode 26.6 — старый линкер не понимает новые `.tbd`         | `SDKROOT` на SDK из Xcode в `scripts/build-mac-local.cjs`                   |
| `npm ci` не выполнял install-скрипты                                | политика npm 12 `allowScripts` (7 пакетов: `node-pty`, `better-sqlite3`, `@serialport/bindings-cpp`, `cpu-features`, `esbuild`, `ssh2`, `fsevents`) | список разрешённых уже в `package.json` + патчи применяются явно при сборке |

Краш-репорт `spawn-helper` в `DiagnosticReports` возникал и при ручном запуске
бинарника с не-tty stdin — то есть причина №3 воспроизводится независимо от
Termix.

---

## 3. Что именно исправлено (по файлам)

Все правки — в клоне на Рабочем столе; upstream не затрагивался.

| Файл                             | Тип                | Что делает                                                                    |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `scripts/patch-node-pty.cjs`     | новый (288 строк)  | закрывает причины №1–№4 и отдаёт наружу функцию `chmodSpawnHelpers()`         |
| `scripts/build-mac-local.cjs`    | новый (131 строка) | сборка одной командой + подпись                                               |
| `packaging/build/after-pack.cjs` | изменён (+57)      | восстановление прав на helper внутри уже упакованного приложения (до подписи) |
| `scripts/patch-nan.cjs`          | изменён (+35)      | генерация `cpu-features/buildcheck.gypi`, если файла нет                      |
| `package.json`                   | изменён (+12)      | `patch-node-pty.cjs` добавлен в `postinstall`; новый скрипт `build:mac-local` |
| `README_LOCAL.md`                | новый              | этот документ                                                                 |

### 3.1. `scripts/patch-node-pty.cjs`

Написан в стиле существующих `patch-*.cjs` (идемпотентный `patchFile()`
с проверкой `source.includes(patched)`, логи с префиксом `[patch-node-pty]`).
Пять правок:

1. **`chmodSpawnHelpers(dir)`** — рекурсивно находит все файлы `spawn-helper`
   и ставит `0755`, если нет флага исполнения. Возвращает число исправленных
   файлов; используется и в `postinstall`, и в `after-pack.cjs`.
2. **`lib/unixTerminal.js`** — вместо наивного `.replace('app.asar', …)`:
   сегмент `.asar` переписывается регуляркой `\.asar(?=[/\\]|$)` (ловит и
   `app.asar`, и `app-arm64.asar`, и `node_modules.asar`) с проверкой
   `fs.existsSync`, плюс в рантайме `fs.chmodSync(helperPath, 0o755)` в
   `try/catch` — самовосстановление прав перед первым форком.
3. **`src/unixTerminal.ts`** — то же самое в исходнике TypeScript, чтобы
   `src` и `lib` не расходились.
4. **`src/unix/spawn-helper.cc`** — переписан целиком: проверка `argc < 3`
   (`_exit(2)`), `ttyname()` с проверкой на `NULL`, `chdir` с диагностикой
   в stderr, `execvp` с сообщением и кодом `127` вместо молчаливого `1`.
5. **`src/unix/pty.cc`** — во всех пяти ранних `return` внутри
   `pty_posix_spawn()` записывается `*err = errno != 0 ? errno : EIO`, а
   `throw` теперь содержит `strerror(err)`, код ошибки и путь к helper:

```cpp
throw Napi::Error::New(
    napiEnv,
    "posix_spawnp failed: " + std::string(strerror(err)) + " (errno " +
        std::to_string(err) + ", helper: " + helper_path + ")");
```

### 3.2. `packaging/build/after-pack.cjs`

Раньше функция выходила сразу, если сборка не `dir`-target, и только писала
маркер `.portable`. Теперь (как в upstream PR #1417, но с учётом переименованных
asar-архивов) она после упаковки проходит по всем `*.asar.unpacked` в
`Contents/Resources` и вызывает `chmodSpawnHelpers()` — то есть права на helper
гарантированно восстановлены до подписи приложения.

### 3.3. `scripts/build-mac-local.cjs` и npm-скрипты

Новый скрипт `npm run build:mac-local` делает всё по шагам:

1. определяет `SDKROOT` (SDK из Xcode, а не из Command Line Tools) и
   `DEVELOPER_DIR`;
2. прогоняет `patch-better-sqlite3.cjs`, `patch-nan.cjs`, `patch-node-pty.cjs`
   — на случай, если `postinstall` при `npm ci` был пропущен;
3. `npm run build` — Vite-фронтенд + `tsc` бэкенд в `dist/`;
4. `electron-rebuild -f -o better-sqlite3,@serialport/bindings-cpp,node-pty` —
   нативные модули под ABI Electron (здесь же компилируется пропатченный
   `spawn-helper` из исходников);
5. `npm run electron:patch-builder`;
6. `electron-builder --mac dir --arm64` → `release/mac-arm64/Termix.app`;
7. восстановление прав `0755` на `spawn-helper` внутри пакета;
8. ad-hoc подпись `codesign --force --deep --sign - --options runtime` с
   энтайтлментами `packaging/build/entitlements.mac.plist` и проверка
   `codesign --verify --deep`.

В `package.json` добавлена строка
`"build:mac-local": "node scripts/build-mac-local.cjs"`, а `postinstall` теперь
заканчивается на `… && node scripts/patch-node-pty.cjs && node scripts/patch-xterm-android-ime.cjs`.

---

## 4. Как пересобрать и установить

```bash
cd /Users/aleksandrhohon/Desktop/development_locall/termix

npm ci                    # только при первом запуске / после правки зависимостей
npm run build:mac-local   # сборка + подпись, ~1-2 минуты
open release/mac-arm64/Termix.app

# обновить установленную копию
osascript -e 'quit app "Termix"'
rm -rf /Applications/Termix.app
cp -R release/mac-arm64/Termix.app /Applications/
open -a Termix
```

Логи сборки удобно писать в файл: `npm run build:mac-local > /tmp/build.log 2>&1 &`.

Данные приложения (`~/Library/Application Support/termix`) при пересборке
не трогаются: хосты, ключи и настройки остаются на месте.

---

## 5. Как проверялось (evidence)

| Проверка                                                                           | Результат                                                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Права до фикса                                                                     | `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` → `-rw-r--r--`, запуск `exit=126 Permission denied` |
| Права после фикса                                                                  | `-rwxr-xr-x`, запуск идёт (`exit=1` на неверном cwd — уже логика helper)                                        |
| GUI-репро на настоящем Electron (спавн `/bin/zsh -l` как в `local-terminal-start`) | `SPAWN_OK_ALIVE` с реальным приглашением zsh                                                                    |
| Принудительно вернул helper в `644`                                                | спавн всё равно прошёл, права самовосстановились в `rwxr-xr-x` (self-heal)                                      |
| Упакованное приложение                                                             | `PACKAGED_SPAWN_OK`                                                                                             |
| Приложение из `/Applications`                                                      | `INSTALLED_SPAWN_OK`                                                                                            |
| Пропатченный helper в пакете                                                       | в `build/Release/spawn-helper` присутствует строка `spawn-helper: usage: …`                                     |
| Подпись                                                                            | `codesign --verify --deep` → `valid on disk`, `Identifier=com.karmaa.termix`, `Signature=adhoc`                 |
| Краш-репорты                                                                       | новых `spawn-helper`/`Termix` в `~/Library/Logs/DiagnosticReports` не появилось                                 |

Тестовые скрипты, которыми это проверялось, лежат в `/tmp/ptygui/`:
`main.js` (GUI-репро), `packaged.js`, `installed.js`.

---

## 6. Кастомизация

| Что менять                                      | Где                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Название приложения, bundle id, иконки, targets | `electron-builder.json` (`productName`, `appId`, `icon`, `directories.output`) |
| Иконки                                          | `public/icon.*` (генерация: `node scripts/generate-icons.mjs`)                 |
| Интерфейс                                       | `src/ui/**` (React + Vite)                                                     |
| Бэкенд (API, работа с хостами, БД)              | `src/backend/**`                                                               |
| Electron-процесс, локальный терминал            | `electron/main.cjs`, `electron/local-shell.cjs`                                |
| Какой шелл запускать локально                   | переменная окружения `TERMIX_LOCAL_SHELL` (иначе `$SHELL`, иначе `/bin/zsh`)   |
| Раскладки/шрифты/тема                           | `src/ui/**`, `public/fonts/**`                                                 |

После правок — `npm run build:mac-local` и копирование в `/Applications`.

Важно: если поменять `appId`, изменится и путь данных приложения — старые
`~/Library/Application Support/termix` при этом останутся на диске (переименуются
в новую папку не автоматически, копировать руками).

## 7. Диагностика

Где смотреть:

| Что                                      | Путь                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| Лог приложения (backend, сессии, ошибки) | `~/Library/Application Support/termix/termix-main.log` |
| Краш-репорты macOS                       | `~/Library/Logs/DiagnosticReports/`                    |
| Лог сборки                               | тот файл, куда перенаправили вывод `build:mac-local`   |

Типовые ошибки и что они значат:

| Сообщение                                                                        | Значение                                                             | Действие                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| `posix_spawnp failed: Permission denied (errno 13, helper: …)`                   | helper снова без exec-бита (например, переустановили `node_modules`) | `node scripts/patch-node-pty.cjs`              |
| `posix_spawnp failed: No such file or directory (errno 2, helper: …/app.asar/…)` | путь к helper внутри asar-архива                                     | проверить, что `lib/unixTerminal.js` пропатчен |
| `spawn-helper: usage: spawn-helper <cwd> <file> [args...]`                       | неверные аргументы helper (не наш случай, но теперь не падает молча) | —                                              |
| `spawn-helper: chdir(…) failed: …`                                               | рабочая директория недоступна                                        | проверить `cwd`/права                          |
| `ld: unknown architecture arm64e.x1-macos`                                       | сборка не с Xcode-овским `SDKROOT`                                   | собирать через `npm run build:mac-local`       |
| `gyp: buildcheck.gypi not found`                                                 | у `cpu-features` нет сгенерированного gyp-включаемого файла          | `node scripts/patch-nan.cjs`                   |

Проверить helper вручную:

```bash
H=/Applications/Termix.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper
stat -f '%Sp %N' "$H"                 # ожидается -rwxr-xr-x
strings "$H" | grep 'spawn-helper: usage'   # есть → версия пропатчена
```

## 8. Обновление из upstream и откат патчей

```bash
cd /Users/aleksandrhohon/Desktop/development_locall/termix
git remote -v                # origin → Termix-SSH/Termix
git fetch origin
git merge origin/main        # или git rebase
npm ci && npm run build:mac-local
```

Конфликты возможны в `package.json` (строка `postinstall`) и
`packaging/build/after-pack.cjs`. Патчи node-pty отдельным файлом, поэтому
обновление `node-pty` их не ломает: `scripts/patch-node-pty.cjs` применяется
заново, если исходники снова «чистые».

Откатить локальные правки (собрать как upstream): `git checkout -- package.json
packaging/build/after-pack.cjs scripts/patch-nan.cjs && rm scripts/patch-node-pty.cjs
scripts/build-mac-local.cjs`.

## 9. Что осталось от brew и что можно убрать

| Остаток                                                                 | Можно удалять?                        |
| ----------------------------------------------------------------------- | ------------------------------------- |
| `~/Library/Caches/Homebrew/downloads/…--termix_macos_universal_dmg.dmg` | Да, это просто скачанный образ        |
| `release/` внутри клона (~1 ГБ)                                         | Да, пересоберётся заново              |
| `node_modules/` (~700 МБ)                                               | Да, восстановится через `npm ci`      |
| `~/Library/Application Support/termix`                                  | **Нет** — там хосты и ключи           |
| `~/Library/Logs/DiagnosticReports/spawn-helper-2026-09-19-162800.ips`   | Да, это старое падение (историческое) |

## 10. Ограничения

- Собрана и проверена только сборка `mac dir arm64`. Universal/dmg/mas/notarize
  и сборки под Windows/Linux не проверялись (в `electron-builder.json` таргеты
  `mas`/`dmg` остались как в upstream).
- Подпись — ad-hoc (`Signature=adhoc`, без Team ID). Локально и после
  копирования внутрь системы работает; для распространения на другие машины
  потребуется Developer ID и нотаризация (`APPLE_ID`, `APPLE_ID_PASSWORD`,
  `APPLE_TEAM_ID` — тогда `packaging/build/notarize.cjs` сработает сам).
- `notarize.cjs` в текущей конфигурации молча пропускает нотаризацию, если
  переменные `APPLE_*` не заданы.
- При любом `brew install --cask termix` вернётся «сломанная» сборка: наши
  патчи живут только в этом клоне.

---

## 11. Чужой проект: лицензия и как с ним работать

### 11.1. Лицензия

Upstream распространяется под **Apache License 2.0**, © 2025 Luke Gustafson
(файл `LICENSE` в корне). Что это значит практически:

| Можно                                            | Нельзя / нужно                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Свободно использовать, менять, собирать локально | Удалять/подменять `LICENSE` и `NOTICE`                                                                                                                                                     |
| Распространять свои сборки (в т.ч. форки)        | Распространять молча: по §4b изменённые файлы обязаны нести пометку об изменении — она добавлена в `scripts/patch-nan.cjs`, `packaging/build/after-pack.cjs`, `scripts/patch-node-pty.cjs` |
| Держать форк публично или приватно               | Использовать имя/логотип Termix как «свой» бренд (§6, товарные знаки не передаются) — при публикации лучше переименовать (`productName`, `appId`)                                          |
| Отправлять пул-реквесты                          | Требовать от авторов поддержки нашего форка                                                                                                                                                |

Для личного использования на своей машине никаких обязательств не возникает:
мы ничего не публикуем.

### 11.2. Как устроен git после настройки

```bash
upstream  https://github.com/Termix-SSH/Termix.git   # чужой репозиторий, только чтение
origin    <ваш форк, когда появится>                 # или отсутствует
main                                         # зеркало upstream, коммитить сюда нельзя
local/macos-pty-fixes                        # наша рабочая ветка с правками
```

`origin` переименован в `upstream` специально: чтобы случайный `git push` не
пытался что-то отправить в чужой репозиторий.

### 11.3. Рабочий цикл

```bash
cd /Users/aleksandrhohon/Desktop/development_locall/termix

# правки кода
git checkout local/macos-pty-fixes
# ... редактируем src/**, electron/**, scripts/** ...
npm run build:mac-local
git add -A && git commit -m "..."

# обновление из чужого репозитория
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout local/macos-pty-fixes && git rebase main
npm ci && npm run build:mac-local
```

Конфликты ожидаемы только в `package.json` (строка `postinstall`) и
`packaging/build/after-pack.cjs` — наши патчи вынесены в отдельный файл
`scripts/patch-node-pty.cjs`, поэтому обновления upstream их не затирают.

### 11.4. Варианты хранения правок

| Вариант                                                            | Плюсы                                                            | Минусы                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Локальные коммиты в ветке `local/macos-pty-fixes` (текущий)        | ничего не публикуется, история есть, можно бэкапить `git bundle` | нет внешнего бэкапа                                        |
| Форк на GitHub (создаётся через веб-интерфейс, `gh` не установлен) | бэкап, можно ставить приватным, удобно обновлять                 | нужен аккаунт и один ручной шаг в браузере                 |
| Пул-реквест в upstream                                             | патчи перестают быть «нашими»: автор чинит у себя                | ревью, сроки, часть правок дублирует уже открытый PR #1417 |

`git bundle` для локального бэкапа:

```bash
git bundle create ~/Desktop/termix-local-fixes.bundle main local/macos-pty-fixes
```

### 11.5. Когда можно отказаться от форка

Если upstream выпустит релиз, где `spawn-helper` исполняемый и путь к нему
резолвится корректно (PR #1417 влит и попал в релиз), можно вернуться на
`brew install --cask termix` — тогда наши патчи не нужны, а `/Applications`
можно заменить официальной сборкой.

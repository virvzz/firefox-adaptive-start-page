# FASP — Миграционный контекст для следующего чата

## Кратко о проекте

**Firefox Adaptive Start Page (FASP)** — расширение для Firefox, заменяющее стандартную страницу новой вкладки на настраиваемый дашборд с плитками быстрого доступа, генеративными фонами, интеграцией с закладками и синхронизацией.

Стек: React 19 + TypeScript + Vite + TailwindCSS 4 + Zustand + IndexedDB (idb) + @dnd-kit

---

## Как запустить сборку

Node.js: `E:\DEEPSEEK\Node.js\node-v22.12.0-win-x64\node.exe`. В PATH отсутствует, поэтому:

```bash
cmd /c "set PATH=E:\DEEPSEEK\Node.js\node-v22.12.0-win-x64;%PATH% && cd /d E:\DEEPSEEK\Firefox Extension && npx vite build"
```

Готовое расширение: `dist/`. Загрузка в Firefox:
- `about:debugging#/runtime/this-firefox` → «Загрузить временное дополнение» → `dist/manifest.json`
- **Важно:** после изменений manifest.json (permissions) нужно **удалить** и **заново загрузить** расширение (кнопка «Обновить» не подхватывает новые permissions)

---

## Текущее состояние (после доработок 17.06.2026)

### ✅ Реализовано:

#### Ядро
- ✅ Layout Engine — сетка 2-12 колонок, spacing, adaptive scaling
- ✅ Tile System — карточки сайтов/папок с favicon и Drag & Drop
- ✅ IndexedDB-хранилище плиток с персистенцией
- ✅ Background Engine — Canvas: Perlin Noise + Particles (анимированные)
- ✅ Статический фон — загрузка пользовательского изображения
- ✅ Импорт топ-сайтов Firefox (`browser.topSites.get()`) при первом запуске
- ✅ Fallback: импорт из панели закладок (`bookmarks.getSubTree('toolbar_____')`)
- ✅ Папки-оверлеи с вложенными плитками
- ✅ Background script — слушатели изменений закладок Firefox
- ✅ Tile Appearance Engine — извлечение доминантных цветов из favicon

#### Панель настроек (редизайн)
- ✅ SettingsModal — главный контейнер: левый сайдбар + контент + футер
- ✅ SettingsSidebar — 8 секций с SVG-иконками, glow-эффект активного элемента
- ✅ ToggleSwitch — анимированный переключатель с фиолетовым свечением (#8b5cf6)
- ✅ SliderControl — слайдер с градиентным треком и glow-thumb
- ✅ SettingsDropdown — кастомный выпадающий список (стеклянный стиль)
- ✅ PreviewCard — live-превью плитки в секциях «Внешний вид» и «Плитки»
- ✅ 8 секций: Внешний вид, Макет, Фон, Плитки, Виджеты, Синхронизация, Дополнительно, О программе
- ✅ Русский язык интерфейса
- ✅ Стиль: glassmorphism + фиолетовые акценты #8b5cf6 + плавные анимации

#### Виджеты
- ✅ Поисковая строка (Google) — включается в настройках
- ✅ Часы (время + дата на русском) — включаются в настройках

#### Контекстное меню (ПКМ)
- ✅ На пустом месте: «Добавить сайт», «Создать папку»
- ✅ На плитке: «Изменить» (URL, название, картинка), «Удалить» (с подтверждением)
- ✅ На папке: дополнительно «Добавить сайт в папку»
- ✅ Форма добавления — URL, название, выбор: авто-превью / своя картинка (из файла)
- ✅ Форма единого размера (w-80) и для ПКМ, и для кнопки «+»
- ✅ Закрытие: Esc, клик вне области, кнопка «Отмена» (НЕ закрывается при повторном ПКМ)

#### Кнопка «+» в сетке
- ✅ Всегда видна последней плиткой с пунктирной рамкой
- ✅ Открывает диалог добавления (оверлей с затемнением)
- ✅ Переключатель Авто-превью / Своя картинка

#### Стилизация
- ✅ Скругление углов из настроек применяется к плиткам (TileCard читает settings.borderRadiusDefault)
- ✅ Прозрачность из настроек применяется к плиткам
- ✅ Glassmorphism из настроек применяется к плиткам

#### Техническое
- ✅ `base: ''` в vite.config.ts — относительные пути в HTML (исправлен баг загрузки)
- ✅ `ignoreDeprecations: "6.0"` в tsconfig.json
- ✅ Декларации `browser.topSites.get()` и `browser.bookmarks.getSubTree()` в `browser.d.ts`
- ✅ `"topSites"` permission в manifest.json
- ✅ `AppSettings` расширен: `showWeather`, `showRecentTabs`
- ✅ `settingsStore` расширен: `setShowWeather`, `setShowRecentTabs`, `resetSettings`
- ✅ Исправлен useMemo в TileGrid: добавлен `tiles` в зависимости

### ❌ НЕ реализовано (ждёт):

#### Критичные баги
1. **Авто-превью не создаются** — при добавлении сайта с «Авто-превью» должен автоматически генерироваться скриншот главной страницы. Сейчас используется только favicon через DuckDuckGo (`https://icons.duckduckgo.com/ip3/{host}.ico`). Нужен механизм headless screenshot (html2canvas или Puppeteer-микросервис). В TileCard: строка 63 — `showImage = tile.customImage || tile.thumbnail || faviconUrl(tile.url!)`. Поле `thumbnail` никогда не заполняется.

2. **Кастомная картинка не меняется при редактировании** — в форме «Изменить» через ПКМ можно поменять картинку, но `TileCard` не перерендеривается, т.к. `memo` не видит изменения `customImage`. Нужно либо убрать `memo`, либо добавить `tile.customImage` в сравнение.

3. **Топ-сайты приходят не те** — `browser.topSites.get()` работает, но может возвращать не те сайты, которые пользователь видит на стандартной странице Firefox. Нужно проверить API и возможно добавить импорт из закладок как основной метод.

4. **Папки создаются, но не отображаются как папки iOS/Android** — в TileCard есть иконка папки (SVG), но папка выглядит как обычная плитка. Нужен дизайн «папка с приложениями»: сетка мини-иконок внутри плитки, как на мобильных ОС.

#### Функциональность Phase 2
- ❌ Полноценный импорт из Firefox bookmarks с UI выбора папок
- ❌ Превью-скриншоты сайтов (html2canvas / Puppeteer)
- ❌ Внешние API для обоев (Unsplash/Wallhaven/Pexels)
- ❌ Session Groups (профили)
- ❌ Keyboard Navigation (Alt+1...Alt+9)
- ❌ Локальный поиск по плиткам
- ❌ CSS Injection
- ❌ Синхронизация через облака (Dropbox/Google Drive/Nextcloud)
- ❌ Виджет погоды (toggle есть, реализации нет)
- ❌ Виджет «Последние вкладки» (toggle есть, реализации нет)
- ❌ Тёмная/светлая тема (переключатель есть, но тема всегда тёмная)

#### Баги и недоработки
- ❌ Drag & drop анимация подтормаживает на большом количестве плиток (оптимизирована через CSS transition, но нужна более плавная)
- ❌ SettingsDropdown выпадающий список может не влезать по высоте в модал (добавлен max-h-48, но не протестирован)
- ❌ `browser.d.ts` содержит неполные декларации (skipLibCheck: true скрывает ошибки)
- ❌ Дублирование директорий `public/` и `Extension/public/` — непонятно, какая актуальна
- ❌ HTML собирается в `dist/src/newtab/index.html`, копируется в `dist/newtab.html` плагином — костыль
- ❌ Иконки сгенерированы Python-скриптом — градиенты, нужны нормальные
- ❌ Нет валидации URL при добавлении сайта — `abc` превращается в `https://abc`
- ❌ Нет `.gitignore`
- ❌ Вкладки «Погода» и «Последние вкладки» в настройках есть, но сами виджеты не реализованы

---

## Структура файлов (актуальная)

```
E:\DEEPSEEK\Firefox Extension\
├── package.json              # Зависимости и скрипты
├── package-lock.json
├── tsconfig.json             # TypeScript-конфиг (ignoreDeprecations: 6.0)
├── vite.config.ts            # Сборщик Vite + base: '' + copyPublicAssets
├── UI.md                     # ТЗ на редизайн настроек
├── Техническое задание.md    # Исходное ТЗ проекта
├── MIGRATION.md              # Этот файл
├── public/
│   ├── manifest.json         # Манифест v3 + topSites permission
│   └── icons/                # Иконки 16, 32, 48, 96 px
├── src/
│   ├── background/
│   │   └── index.ts          # Service worker (bookmark listeners + get-bookmarks)
│   ├── engines/
│   │   └── tileAppearance.ts # Доминантные цвета + favicon
│   ├── newtab/
│   │   ├── index.html        # HTML-страница newtab
│   │   ├── main.tsx          # Точка входа React
│   │   ├── App.tsx           # Корневой компонент + ClockWidget + SearchBar
│   │   ├── styles/
│   │   │   └── index.css     # Tailwind + стекломорфизм + анимации fadeIn/scaleIn
│   │   ├── components/
│   │   │   ├── Background/
│   │   │   │   └── BackgroundLayer.tsx
│   │   │   ├── Tile/
│   │   │   │   └── TileCard.tsx          # Карточка плитки (memo, использует settingsStore)
│   │   │   ├── LayoutEngine/
│   │   │   │   └── TileGrid.tsx          # Сетка + кнопка «+» + диалог добавления
│   │   │   ├── TileFolder/
│   │   │   │   └── TileFolder.tsx        # Оверлей папки
│   │   │   ├── ContextMenu/
│   │   │   │   └── ContextMenu.tsx       # ПКМ: добавить/изменить/удалить/создать папку
│   │   │   └── Settings/
│   │   │       ├── SettingsPanel.tsx     # Реэкспорт SettingsModal как SettingsPanel
│   │   │       ├── SettingsModal.tsx     # Главное модальное окно (8 секций)
│   │   │       ├── SettingsSidebar.tsx   # Левая панель навигации
│   │   │       ├── SettingsDropdown.tsx  # Кастомный выпадающий список
│   │   │       ├── SliderControl.tsx     # Слайдер с градиентом
│   │   │       ├── ToggleSwitch.tsx      # Анимированный переключатель
│   │   │       └── PreviewCard.tsx       # Live-превью плитки
│   │   └── stores/
│   │       ├── tilesStore.ts     # Хранилище плиток + importTopSites + importBookmarkToolbar
│   │       ├── layoutStore.ts    # Настройки сетки
│   │       ├── backgroundStore.ts # Настройки фона
│   │       └── settingsStore.ts  # AppSettings + resetSettings + все сеттеры
│   └── types/
│       ├── index.ts          # Интерфейсы Tile, LayoutConfig, BackgroundConfig, AppSettings
│       └── browser.d.ts      # Декларации Firefox API (topSites, bookmarks, storage, runtime)
└── dist/                     # Собранное расширение (не коммитить)
    ├── manifest.json
    ├── newtab.html
    ├── newtab.js             # ~292 KB
    ├── background.js
    └── assets/
```

---

## Ключевые моменты для следующего чата

1. **Node.js**: `E:\DEEPSEEK\Node.js\node-v22.12.0-win-x64\node.exe`
2. **Сборка**: `cmd /c "set PATH=E:\DEEPSEEK\Node.js\node-v22.12.0-win-x64;%PATH% && cd /d E:\DEEPSEEK\Firefox Extension && npx vite build"`
3. **Загрузка в Firefox**: `about:debugging` → «Загрузить временное дополнение» → `dist/manifest.json`
4. **При изменении permissions**: удалить расширение и загрузить заново
5. **Приоритет Phase 2**: авто-превью скриншотов, дизайн папок как в iOS/Android, фикс кастомных картинок при редактировании
6. **Виджеты «Погода» и «Последние вкладки»**: toggle есть, реализации нет
7. **Тёмная/светлая тема**: переключатель есть, но CSS всегда тёмный
You are a senior frontend engineer and UI/UX designer.



Refactor my browser extension settings modal completely.



Current implementation works functionally, but the interface looks outdated, visually flat, poorly structured, and not user-friendly.



Goal: redesign the settings panel to feel like a premium modern desktop application (similar to Linear, Arc Browser, Raycast, modern macOS settings, or high-end Linux KDE applications).



STACK REQUIREMENTS (STRICT):



React

TypeScript

TailwindCSS

Functional components only

No external heavy UI libraries (NO Material UI, NO Bootstrap)

Use CSS transitions and animations

Fully responsive

Dark theme by default



DESIGN REQUIREMENTS:



General style:



dark futuristic theme

glassmorphism effect

soft blur background

purple/violet neon accents (#8b5cf6)

smooth shadows

rounded corners everywhere (12-16px)

subtle hover animations

premium feeling interface



Layout:



Do NOT use one long vertical form.



Create LEFT SIDEBAR navigation.



Sidebar sections:



Внешний вид

Макет

Фон

Плитки

Виджеты

Синхронизация

Дополнительно

О программе



Sidebar behavior:



active section highlighted with glow

icons for every section

smooth section switching animation



Main content area on right.



SETTINGS ORGANIZATION:



SECTION 1 — Макет



Количество колонок (slider 2-12)

Отступ между плитками (slider)



SECTION 2 — Фон



Dropdown:



Статический

Онлайн-обои

Генеративный



If Генеративный selected:



Second dropdown:



Perlin Noise

Fractal Flow

Particle Field

Aurora Effect

Plasma Waves



Controls:



Анимация (beautiful toggle switch)

FPS (slider)

Размытие (slider)

Яркость (slider)



Show live preview card on the right.



SECTION 3 — Оформление



Dropdown:



Светлая

Темная

Авто



Controls:



Эффект стекла (toggle)

Прозрачность (slider)

Скругление углов (slider)



SECTION 4 — Виджеты



Beautiful toggle switches:



Поисковая строка

Часы

Погода

Последние вкладки



COMPONENT REQUIREMENTS



Sliders:



thick modern sliders

animated thumb

glow effect when active



Dropdowns:



custom styled

dark glass effect

no native browser select design



Toggles:



animated switch

smooth movement



Buttons:



Bottom right:



Отмена

Сохранить настройки



Bottom left:



Сбросить настройки



TYPOGRAPHY



Use Russian language everywhere.



Typography hierarchy:



Headers:

font-weight 700



Section labels:

font-weight 600



Secondary text:

opacity 60%



Spacing:



large breathing room



IMPORTANT:



Avoid old-fashioned HTML forms.



Make the UI look like premium software released in 2026.



Generate production-ready React + TypeScript code.



Split into components:



SettingsModal.tsx

Sidebar.tsx

SliderControl.tsx

ToggleSwitch.tsx

Dropdown.tsx

PreviewCard.tsx



Use clean architecture.



Code must be beautiful and maintainable.


import { useEffect, useRef, useState } from 'react';

export function WeatherLocationField({
  value,
  onSave,
  onReset,
}: {
  value: string;
  onSave: (location: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!focusedRef.current || draft === value) return undefined;
    const timeout = window.setTimeout(() => onSave(draft), 650);
    return () => window.clearTimeout(timeout);
  }, [draft, onSave, value]);

  return (
    <div className="settings-inline-field mt-3 border-t border-white/5 pt-3">
      <span>Локация</span>
      <input
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          onSave(draft);
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder="Авто или город, например Екатеринбург"
      />
      <div className="settings-inline-field-actions">
        <small>Пусто — автоопределение через wttr.in. Виджет открывает прогноз по клику.</small>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            focusedRef.current = false;
            onReset();
          }}
        >
          Сбросить регион
        </button>
      </div>
    </div>
  );
}

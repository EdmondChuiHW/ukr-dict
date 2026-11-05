import { useEffect, useRef } from 'react';
import { commitQuery, typeQuery } from '../lib/router.ts';

interface Props {
  value: string;
  /** Changes on every non-typing navigation (focus/select handling). */
  navId: number;
}

export function SearchBar({ value, navId }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Autofocus on load and after navigations on devices with a physical keyboard.
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus({ preventScroll: true });
  }, [navId]);

  return (
    <form
      className="search"
      role="search"
      onSubmit={(ev) => {
        ev.preventDefault();
        commitQuery();
        if (window.matchMedia('(pointer: coarse)').matches) ref.current?.blur();
      }}
    >
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="search"
        name="q"
        value={value}
        onChange={(ev) => typeQuery(ev.target.value)}
        placeholder="Шукати слово… / Search a word…"
        aria-label="Search Ukrainian or English"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus
      />
      {value ? (
        <button
          type="button"
          className="clear-btn"
          aria-label="Clear search"
          onClick={() => {
            typeQuery('');
            commitQuery();
            ref.current?.focus();
          }}
        >
          ×
        </button>
      ) : null}
    </form>
  );
}

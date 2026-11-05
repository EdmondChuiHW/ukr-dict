import { clearRecent, useSettings } from '../lib/settings.ts';
import type { ClientState } from '../lib/client.ts';
import { formatCount } from '../lib/labels.ts';
import { RouteLink, WordLink } from './WordLink.tsx';

const EXAMPLES: { word: string; note: string }[] = [
  { word: 'собака', note: 'noun, audio' },
  { word: 'співати', note: 'verb + aspect partner' },
  { word: 'співаю', note: 'inflected form' },
  { word: 'замок', note: 'homonyms' },
  { word: 'зелений', note: 'adjective' },
  { word: 'по', note: 'nested senses' },
  { word: 'dog', note: 'English search' },
];

export function Home({ state }: { state: ClientState }) {
  const { recent } = useSettings();
  return (
    <div className="home">
      <section className="intro">
        <h1>
          Ukrainian–English dictionary <span className="muted">· Українсько-англійський словник</span>
        </h1>
        <p>
          Type a Ukrainian word — in any form, with or without stress marks — or an English word to search the definitions.
          Everything runs in your browser and keeps working offline.
        </p>
        {state.info ? (
          <p className="muted small">
            {formatCount(state.info.counts.entries)} entries · {formatCount(state.info.counts.formKeys)} inflected forms ·{' '}
            {formatCount(state.info.counts.englishTokens)} English index terms
          </p>
        ) : null}
      </section>
      <section className="home-examples" aria-labelledby="ex-h">
        <h2 id="ex-h" className="section-title">
          Try
        </h2>
        <ul className="example-list">
          {EXAMPLES.map((x) => (
            <li key={x.word}>
              <WordLink word={x.word} className="example-chip">
                <span lang={/[a-z]/.test(x.word) ? 'en' : 'uk'}>{x.word}</span>
                <small>{x.note}</small>
              </WordLink>
            </li>
          ))}
        </ul>
      </section>
      {recent.length > 0 ? (
        <section className="recent" aria-labelledby="recent-h">
          <h2 id="recent-h" className="section-title">
            Recently viewed
            <button type="button" className="link-btn small" onClick={clearRecent}>
              clear
            </button>
          </h2>
          <ul className="chips">
            {recent.map((w) => (
              <li key={w}>
                <WordLink word={w} className="chip" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="muted small">
        <RouteLink route={{ q: '', view: 'about' }}>About this dictionary, sources &amp; licenses →</RouteLink>
      </p>
    </div>
  );
}

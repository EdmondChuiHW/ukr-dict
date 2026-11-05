/** About & sources page (?view=about). Lazy-loaded chunk. */
import { BUILTIN_ATTRIBUTIONS } from '@ukdict/shared';
import type { ClientState } from '../lib/client.ts';
import { formatBytes, formatCount } from '../lib/labels.ts';
import { OfflineDetails } from './StatusPill.tsx';
import { WordLink } from './WordLink.tsx';

export default function About({ state }: { state: ClientState }) {
  const info = state.info;
  const attributions = info?.attributions?.length ? info.attributions : BUILTIN_ATTRIBUTIONS;
  return (
    <article className="about">
      <h1>About this dictionary</h1>
      <p>
        A Ukrainian–English dictionary that runs entirely in your browser. It combines the Ukrainian entries of the English
        Wiktionary (definitions, inflection tables, pronunciation, related words), Ukrainian translations listed in English
        Wiktionary entries, inflection tables from <i>Словники України online</i> for words whose Wiktionary entry lacks one, and a
        frequency dictionary that orders entries and search results from common to rare.
      </p>

      <h2>How search works</h2>
      <p>Every keystroke searches all of the following; each entry is shown once, in its best group, most frequent first:</p>
      <ol className="tiers">
        <li>
          <b>Exact stress match</b> — the query has stress marks and equals a stressed headword (<WordLink word="за́мок" /> vs.{' '}
          <WordLink word="замо́к" />).
        </li>
        <li>
          <b>Exact headword</b> — ignoring stress, case and apostrophe variants.
        </li>
        <li>
          <b>Inflected form</b> — the query is a form in a declension/conjugation table (<WordLink word="співаю" />); the matching
          table cell is highlighted.
        </li>
        <li>
          <b>Words starting with</b> the query.
        </li>
        <li>
          <b>Words containing</b> the query (two letters or more).
        </li>
        <li>
          <b>English definitions</b> — Latin-script queries search the English glosses (all words must match; the last word may be
          incomplete). Definitions that consist of exactly the query word rank first (<WordLink word="dog" />).
        </li>
      </ol>
      <p className="muted">
        Stressed vowels are shown in colour instead of with accent marks. Tables merge identical neighbouring cells; the case order
        (nominative–accusative–genitive… or the traditional nominative–genitive–dative…) can be switched under each table.
      </p>

      <h2>Offline use</h2>
      <p>
        The app itself is cached by a service worker. The dictionary data loads in stages: a small headword index first, then
        everything else in the background. Once the download has finished the dictionary works without a network connection
        (pronunciation audio is cached after it has been played once).
      </p>
      <OfflineDetails state={state} />

      <h2>Sources &amp; licenses</h2>
      <ul className="attributions">
        {attributions.map((a) => (
          <li key={a.id}>
            <h3>{a.url ? <a href={a.url} target="_blank" rel="noopener">{a.name}</a> : a.name}</h3>
            <p>{a.description}</p>
            {a.license ? (
              <p className="muted small">
                License: {a.licenseUrl ? <a href={a.licenseUrl} target="_blank" rel="noopener">{a.license}</a> : a.license}
              </p>
            ) : a.url ? (
              <p className="muted small">License: not stated by the publisher — credited as the source; see the link above.</p>
            ) : null}
          </li>
        ))}
      </ul>

      <h2>Created entries</h2>
      <p>
        Some Ukrainian words appear only as translations in English Wiktionary entries and have no Ukrainian entry of their own.
        Such words get a <span className="badge created">created</span> entry whose definitions are the English words they
        translate; each links to the English pages it came from. They are ranked after regular entries.
      </p>
      <h2>Словники України (lcorp)</h2>
      <p>
        Inflection tables marked “Inflection: Словники України (lcorp)” come from{' '}
        <a href="https://lcorp.ulif.org.ua/dictua/" target="_blank" rel="noopener">
          lcorp.ulif.org.ua
        </a>
        . The site has no per-word addresses, so entries link to its search page — search for the word there.
      </p>

      <h2>Data build</h2>
      {info ? (
        <dl className="build-info">
          <div>
            <dt>Built</dt>
            <dd>{new Date(info.builtAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          </div>
          <div>
            <dt>Build id</dt>
            <dd>
              <code>{info.buildId}</code>
            </dd>
          </div>
          <div>
            <dt>Entries</dt>
            <dd>
              {formatCount(info.counts.entries)} ({formatCount(info.counts.createdEntries)} created; {formatCount(info.counts.ignoredEntries)}{' '}
              inflected-form entries folded into their lemmas)
            </dd>
          </div>
          <div>
            <dt>Index</dt>
            <dd>
              {formatCount(info.counts.headwordKeys)} headwords · {formatCount(info.counts.formKeys)} inflected forms ·{' '}
              {formatCount(info.counts.englishTokens)} English terms
            </dd>
          </div>
          <div>
            <dt>Download size</dt>
            <dd>
              {formatBytes(info.totalBytes)} in {info.fileCount} files (first load: {formatBytes(info.coreBytes)} index +{' '}
              {formatBytes(info.summariesBytes)} summaries)
            </dd>
          </div>
          {Object.entries(info.provenance).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{typeof v === 'number' ? formatCount(v) : v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">Data not loaded yet.</p>
      )}
    </article>
  );
}

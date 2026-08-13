'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Holds no state and renders nothing. It binds one keyboard shortcut.
 *
 * Why a client component at all: this is the whole of the "command palette"
 * question, answered at the size the answer is worth. AgentDock is a catalogue
 * with one search route, and the thing a developer reaches for in a catalogue is
 * the key that puts the cursor in the search box. A palette with its own overlay
 * would be a second search surface — its own result rendering, its own empty
 * state, its own idea of what matches — built over the same route the page
 * already renders, and the two would drift. There is no new query, no new
 * endpoint and no overlay here: the key focuses the field the server already
 * sent, or navigates to the route that contains it.
 *
 * `/` is the advertised key — the hint drawn inside the search field, as
 * `.search-row .field::after` — because it is the one that is right on every
 * platform, and that hint is server-rendered and cannot know which platform it
 * landed on. Ctrl+K and Cmd+K work too, unadvertised, because they are what a
 * hand trained on every other developer tool tries first.
 *
 * The guard is the whole correctness surface: `/` is an ordinary character, so
 * it must reach any field a reader is typing in. The chord is not, so it works
 * from inside a field as well — including from inside the search box itself,
 * where it selects the existing query so the next keystroke replaces it.
 *
 * Everything this enables is already reachable without it. The search box is a
 * plain form the server renders, the nav link beside it goes to the same place,
 * and with JavaScript disabled this component does not exist and nothing about
 * the page changes.
 */
export function SearchHotkey() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A chord with a modifier is never a character someone is typing.
      const chord =
        (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!chord && !slash) return;

      if (slash) {
        // `/` is a character before it is a shortcut. Anywhere a reader could be
        // typing one, it stays a character.
        const target = event.target;
        if (target instanceof HTMLElement && target.isContentEditable) return;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          return;
        }
      }

      const field = document.getElementById('q');
      if (field instanceof HTMLInputElement) {
        event.preventDefault();
        field.focus();
        // The whole query, so the next keystroke replaces it rather than
        // appending to it — which is what re-opening a search is usually for.
        field.select();
        return;
      }

      // Not on a page that has the field. Go to the one that does; its own
      // autofocus is not assumed, so the reader lands on the search route with
      // the form in view.
      event.preventDefault();
      router.push('/artifacts');
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return null;
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Holds no state and renders nothing. It binds one keyboard shortcut.
 *
 * Why a client component at all: the key has to reach a field the server already
 * sent, and only the client knows which page it landed on. There are three
 * outcomes, in order:
 *
 *   1. The page has the search field (`/artifacts`) — focus it and select what
 *      is in it, so the next keystroke replaces the previous query.
 *   2. It does not — open `SearchLauncher`'s <dialog> with `showModal()`. The
 *      top layer, the focus trap, the inert background and Escape are the
 *      platform's; this call is the entire client cost of the palette.
 *   3. Neither is available — navigate to `/artifacts`, which has the field.
 *      This is the path a browser without <dialog> takes, and the path this
 *      component took for every page before the launcher existed.
 *
 * What is deliberately absent from all three is a second search implementation.
 * The launcher submits a GET to `/artifacts` with the same `q` the page's own
 * form submits; there is no new query, no new endpoint, and nothing renders a
 * result anywhere but on the route that already does.
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

      const dialog = document.getElementById('search-launcher');
      const isDialog = dialog instanceof HTMLDialogElement;

      // The chord fires from inside a field, including from inside the
      // launcher's own. Pressing it again while the launcher is open must not
      // fall through to the navigation below, which would leave the modal open
      // over a page change.
      if (isDialog && dialog.open) {
        const inside = document.getElementById('launcher-q');
        if (inside instanceof HTMLInputElement) {
          event.preventDefault();
          inside.select();
        }
        return;
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

      // Not on a page that has the field. Open the launcher over this one — no
      // navigation, so the page a reader was reading is still there behind it
      // and still there when they press Escape.
      if (isDialog) {
        event.preventDefault();
        dialog.showModal();
        return;
      }

      // No field and no <dialog> support. Go to the route that has the field.
      event.preventDefault();
      router.push('/artifacts');
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return null;
}

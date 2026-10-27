import { type ReactNode, ViewTransition } from 'react';

/**
 * The page transition, and the whole of it on the React side. The root template
 * re-mounts when the first URL segment changes — home, /artifacts, /r, /jobs —
 * so `enter` and `exit` fire on a move between those sections and not within
 * one: /r/o/r → /r/o/r/path and /jobs/1 → /jobs/2 swap without it. That is the
 * boundary on purpose; a transition per section move is the cut a reader
 * notices, and nested templates would be four more files for the rest. The
 * header and footer sit in the layout and do not move. What the two classes
 * animate is in globals.css's motion block, which is also why a reader who
 * asked for less motion gets an instant swap: the keyframes do not exist for
 * them.
 *
 * `enter` and `exit` are plain strings, so a browser back or forward plays them
 * too. Accepted: on iOS Safari a swipe back already animates, and the 120ms
 * fade lands under the end of it.
 *
 * `default="none"` is load-bearing. Without it this boundary would also animate
 * every in-place update — and the job page's PollUntilDone refreshes the route
 * every 2 s while a job runs, which would fade the page on every poll.
 * Measured with it: four refreshes in 6.5 s on a running job, zero view
 * transitions started.
 *
 * A server component, and React already ships ViewTransition to the client, so
 * this adds no client JavaScript and no client component. A browser without the
 * View Transitions API navigates exactly as it did before.
 */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}

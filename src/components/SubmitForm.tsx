'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { type SubmitState, submitRepo } from '@/app/actions';

const initial: SubmitState = { status: 'idle', message: '' };

/**
 * The only client component in the project, and it holds no data — only the
 * pending flag. Without JavaScript the form still submits and the server still
 * re-renders with the result.
 */
export function SubmitForm() {
  const [state, action, pending] = useActionState(submitRepo, initial);

  return (
    <form action={action} className="submit">
      <label htmlFor="repo">GitHub repository</label>
      <div className="submit-row">
        <input
          id="repo"
          name="repo"
          required
          placeholder="anthropics/skills"
          // Cosmetic only. The enforcement is in the server action.
          pattern="[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+"
          aria-describedby="repo-help repo-result"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Index'}
        </button>
      </div>
      <p id="repo-help" className="muted">
        Owner and repository, like <code>anthropics/skills</code>. Public repositories only.
      </p>
      <p
        id="repo-result"
        role="status"
        aria-live="polite"
        className={state.status === 'error' ? 'error' : 'ok'}
      >
        {state.message}
        {state.href ? <Link href={state.href}> View repository</Link> : null}
      </p>
    </form>
  );
}

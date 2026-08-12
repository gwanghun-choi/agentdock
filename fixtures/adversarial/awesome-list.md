# Awesome Claude Code Sentinels

An input to tests, never fetched and never executed. Every repository named here
is a sentinel under `link-spec-owner/`, so nothing in this file can collide with
a real repository a suite ingests. Each line exists to pin one extraction shape.

## The three link shapes, all naming one repository

- Markdown link: [claude tooling](https://github.com/link-spec-owner/shape-a)
- Angle brackets: <https://github.com/link-spec-owner/shape-a>
- Bare, at the end of a sentence: https://github.com/link-spec-owner/shape-a.

## Shapes that carry extra path, which is still the same repository

- A deep link into a file: https://github.com/link-spec-owner/shape-b/blob/main/README.md
- A tree link: [browse](https://github.com/link-spec-owner/shape-b/tree/main/skills)
- A clone URL: https://github.com/link-spec-owner/shape-b.git
- With a fragment and a query: https://github.com/link-spec-owner/shape-c?tab=readme#install
- Mixed case, which collapses to one row: [Shape C](https://github.com/Link-Spec-Owner/Shape-C)

## Ordinary entries, the bulk of a real list

- [alpha](https://github.com/link-spec-owner/alpha) — does a thing
- [beta](https://github.com/link-spec-owner/beta) — does another thing
- [gamma](https://github.com/link-spec-owner/gamma) — third thing

## github.com paths that are not repositories, and must yield nothing

- A user page: https://github.com/link-spec-owner
- The organizations view: https://github.com/orgs/link-spec-owner/repositories
- A topic page: https://github.com/topics/claude-code
- The sponsors page: https://github.com/sponsors/link-spec-owner
- A gist, which lives on another host entirely: https://gist.github.com/link-spec-owner/aaaaaaaa
- Raw content, which is a fetch target and not a repository link:
  https://raw.githubusercontent.com/link-spec-owner/alpha/main/README.md

## Other hosts, which must yield nothing

- https://gitlab.com/link-spec-owner/not-github
- https://bitbucket.org/link-spec-owner/not-github
- https://example.com/link-spec-owner/not-github
- A lookalike host: https://github.com.evil.example/link-spec-owner/spoofed
- A userinfo prefix pointing elsewhere: https://github.com@evil.example/link-spec-owner/spoofed
- Plain HTTP is not matched at all: http://github.com/link-spec-owner/insecure

## Malformed tokens that must not throw

- An unterminated scheme: https://
- Spaces immediately after: https:// github.com/link-spec-owner/spaced
- A bare colon path: https://github.com/
- One path segment only: https://github.com/link-spec-owner/

## Working style

- Save usage by not re-reading files already in context, not pasting whole files into
  chat, and not exploring unrelated folders.
- But never skip verification. Before changing, renaming, or removing anything, search
  the repo (grep) for every usage, including public/js, tests, docs, and migrations.
- After a change, run `npm test`. List which files you changed AND which related files you
  checked and found unaffected, so I can see nothing was skipped.
- Before opening each PR, review your own diff critically and list the risks.

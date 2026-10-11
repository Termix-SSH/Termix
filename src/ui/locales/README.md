# Translations

Only `en.json` needs to be updated. Every other language in `translated/` is translated automatically on each release (and by the Translate workflow) with the Termix LLM server, using the translator in [Termix-Registry](https://github.com/Termix-SSH/Termix-Registry/tree/main/translate).

New strings and strings whose English changed are translated. `translations-lock.json` tracks which English text each translation was made from, so don't edit it by hand.

If an automatic translation is wrong, fix it in that language's file. A fixed string is kept until its English changes.

To add a language, add it to `languages.json` here and in `translate/languages.json` in Termix-Registry.

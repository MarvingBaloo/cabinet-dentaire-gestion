// Conventional Commits. Le sujet en français n'impose pas de casse : « feat(auth):
// connexion en deux temps » et « feat(auth): Connexion… » sont tous deux valides,
// alors que la règle par défaut refuse la majuscule.
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
}

export default config

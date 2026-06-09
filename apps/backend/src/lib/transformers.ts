export const pluralize = (
  count: number,
  singular: string,
  plural: string,
  locale: string = 'en-US'
): string => {
  const pluralRules = new Intl.PluralRules(locale);
  const rule = pluralRules.select(count);

  return rule === 'one' ? singular : plural;
};

/** Textos de MUI X DataGrid según el idioma de la ruta. */
import { enUS, esES } from '@mui/x-data-grid/locales';

export function dataGridLocaleText(locale: string) {
  return (locale === 'es' ? esES : enUS).components.MuiDataGrid.defaultProps.localeText;
}

export default Object.assign(sql, { where, set, columns, values, identifier, unnest });

const PLACEHOLDER = '?';

const PREFIX_PLACEHOLDER = '$';

const sqlObjControlsSymbol = Symbol('controls');

enum SqlObjType {
  MAIN,
  WHERE,
  SET,
  VALUES,
  COLUMNS,
  IDENTIFIER,
  UNNEST,
}

function isSqlObject(obj: unknown): obj is SqlObjBase {
  return (obj as SqlObj)?.[sqlObjControlsSymbol] !== undefined;
}

function isColumnsSqlObjectControl(obj: SqlObjControl): obj is SqlObjControl<SqlObjType.COLUMNS> {
  return obj.type === SqlObjType.COLUMNS;
}

function isValuesSqlObjectControl(obj: SqlObjControl): obj is SqlObjControl<SqlObjType.VALUES> {
  return obj.type === SqlObjType.VALUES;
}

function isSetSqlObjectControl(obj: SqlObjControl): obj is SqlObjControl<SqlObjType.SET> {
  return obj.type === SqlObjType.SET;
}

function isWhereSqlObjectControl(obj: SqlObjControl): obj is SqlObjControl<SqlObjType.WHERE> {
  return obj.type === SqlObjType.WHERE;
}

function escapeIdentifier(identifier: string) {
  return identifier
    .split('.')
    .map(part => '"' + part + '"')
    .join('.');
}

function sqlObjectControl<T extends SqlObjType>(type: T) {
  const values: (ValidArg | ValidArg[])[] = [];
  const text: string[] = [];
  const sqlObj = {
    get isEmpty() {
      return !text.some(Boolean);
    },
    type,
    text,
    values,
  };
  return sqlObj;
}

function mergeColumnsSqlObjects(dest: SqlObjControl, source: SqlObjControl<SqlObjType.COLUMNS>) {
  const prefix = source.prefix || (isColumnsSqlObjectControl(dest) && dest.prefix);
  source.text.forEach(txt => {
    if (txt === PREFIX_PLACEHOLDER) prefix && dest.text.push(prefix + '.');
    else dest.text.push(txt);
  });
}

function mergeSqlObjects(dest: SqlObjControl, source: SqlObjControl) {
  if (source.isEmpty) return;
  if (isWhereSqlObjectControl(source)) dest.text.push('WHERE ', ...source.text);
  else if (isSetSqlObjectControl(source)) dest.text.push('SET ', ...source.text);
  else if (isValuesSqlObjectControl(source)) dest.text.push('VALUES ', ...source.text);
  else if (isColumnsSqlObjectControl(source)) mergeColumnsSqlObjects(dest, source);
  else dest.text.push(...source.text);
  dest.values.push(...source.values);
}

function templateStringParserLoop(
  tempStrs: TemplateStringsArray,
  args: (ValidArg | SqlObjBase | undefined)[] = [],
  sqlObj: SqlObjControl,
) {
  for (let i = 0, currArg; i < tempStrs.length; i++) {
    currArg = args[i];
    sqlObj.text.push(tempStrs[i]);
    if (currArg === undefined) continue;
    if (isSqlObject(currArg)) mergeSqlObjects(sqlObj, currArg[sqlObjControlsSymbol]);
    else sqlObj.values.push(currArg), sqlObj.text.push(PLACEHOLDER);
  }
}

function unnest(types: string[], rows: ValidArg[][]) {
  const control = sqlObjectControl(SqlObjType.UNNEST);
  const sqlObj: UnnestSqlObj = {
    [sqlObjControlsSymbol]: control,
  };
  control.text.push('UNNEST(');
  const stopWord = { [types.length - 1]: ')' }; // TODO: Figure out a better name
  types.forEach((type, i) => control.text.push(PLACEHOLDER, '::' + type + (stopWord[i] || ', ')));
  const values: ValidArg[][] = Array.from(types, () => []);
  rows.forEach(row => row.forEach((value, i) => values[i].push(value)));
  control.values.push(...values);
  return sqlObj;
}

function where(tempStrs?: TemplateStringsArray, ...args: (ValidArg | SqlObjBase | undefined)[]) {
  const control = sqlObjectControl(SqlObjType.WHERE);
  const sqlObj: WhereSqlObj = {
    [sqlObjControlsSymbol]: control,
    and(tempStrs, ...args) {
      if (!control.isEmpty) control.text.push(' AND ');
      templateStringParserLoop(tempStrs, args, control);
      return sqlObj;
    },
    or(tempStrs, ...args) {
      if (!control.isEmpty) control.text.push(' OR ');
      templateStringParserLoop(tempStrs, args, control);
      return sqlObj;
    },
    get isEmpty() {
      return control.isEmpty;
    },
  };
  if (tempStrs) templateStringParserLoop(tempStrs, args, control);
  return sqlObj;
}

function set(keyValues: Record<string, ValidArg | SqlObj | undefined>) {
  const control = sqlObjectControl(SqlObjType.SET);
  const sqlObj: UpdateSqlObj = {
    [sqlObjControlsSymbol]: control,
    get isEmpty() {
      return control.isEmpty;
    },
  };
  Object.entries(keyValues).forEach(kv => {
    if (kv[1] === undefined) return;
    control.text.push((control.isEmpty ? '' : ', ') + escapeIdentifier(kv[0]) + ' = ');
    if (isSqlObject(kv[1])) mergeSqlObjects(control, kv[1][sqlObjControlsSymbol]);
    else control.text.push(PLACEHOLDER), control.values.push(kv[1]);
  });
  return sqlObj;
}

function values(rows: ValidArg[][]) {
  const control = sqlObjectControl(SqlObjType.VALUES);
  const sqlObj: ValuesSqlObject = {
    [sqlObjControlsSymbol]: control,
    get isEmpty() {
      return control.isEmpty;
    },
  };
  const stopWord = { [rows.length - 1]: '' }; // TODO: Figure out a better name
  rows.forEach((row, i) => {
    const rowLen = row.length - 1;
    control.text.push('(');
    row.forEach((col, j) => {
      control.text.push(PLACEHOLDER);
      control.values.push(col);
      if (j < rowLen) control.text.push(', ');
    });
    control.text.push(')' + (stopWord[i] ?? ', '));
  });
  return sqlObj;
}

function columns(columns: (string | [string, string] | ColumnsSqlObject | SqlObj)[]) {
  const control = Object.assign(sqlObjectControl(SqlObjType.COLUMNS), { prefix: '' });
  const sqlObj: ColumnsSqlObject = {
    [sqlObjControlsSymbol]: control,
    get isEmpty() {
      return control.isEmpty;
    },
    prefix(prefix: string) {
      control.prefix = escapeIdentifier(prefix);
      return sqlObj;
    },
  };
  const stopWord = { [columns.length - 1]: '' }; // TODO: Figure out a better name
  columns.forEach((col, i) => {
    const _stopWord = stopWord[i];
    if (isSqlObject(col))
      mergeSqlObjects(control, col[sqlObjControlsSymbol]), _stopWord === undefined && control.text.push(', ');
    else if (Array.isArray(col))
      control.text.push(
        PREFIX_PLACEHOLDER,
        escapeIdentifier(col[0]) + ' AS ' + escapeIdentifier(col[1]) + (_stopWord ?? ', '),
      );
    else control.text.push(PREFIX_PLACEHOLDER, escapeIdentifier(col) + (_stopWord ?? ', '));
  });
  return sqlObj;
}

function identifier(str: string) {
  const sqlObj: IdentifierSqlObj = {
    [sqlObjControlsSymbol]: sqlObjectControl(SqlObjType.IDENTIFIER),
  };
  sqlObj[sqlObjControlsSymbol].text.push(escapeIdentifier(str));
  return sqlObj;
}

function sql(tempStrs: TemplateStringsArray, ...args: (ValidArg | SqlObjBase | undefined)[]) {
  const control = sqlObjectControl(SqlObjType.MAIN);
  const sqlObj: SqlObj = {
    [sqlObjControlsSymbol]: control,
    append(sql) {
      sql.forEach(s => s && mergeSqlObjects(control, s[sqlObjControlsSymbol]));
      return sqlObj;
    },
    get isEmpty() {
      return control.isEmpty;
    },
    get text() {
      let i = 0;
      return control.text.map(str => (str === PLACEHOLDER ? (i++, '$' + i) : str)).join('');
    },
    values: control.values,
  };
  templateStringParserLoop(tempStrs, args, control);
  return sqlObj;
}

type ValidArg = string | number | boolean | Date | null;

type SqlObjControl<T extends SqlObjType = SqlObjType> = {
  values: (ValidArg | ValidArg[])[];
  text: string[];
  readonly isEmpty: boolean;
  type: T;
} & ExtraParams[T];

type ExtraParamsMap = {
  [SqlObjType.COLUMNS]: {
    prefix: string;
  };
};

type ExtraParams = ExtraParamsMap & Record<Exclude<SqlObjType, keyof ExtraParamsMap>, unknown>;

interface SqlObjBase<T extends SqlObjType = SqlObjType> {
  [sqlObjControlsSymbol]: SqlObjControl<T>;
}

interface SqlObj extends SqlObjBase<SqlObjType.MAIN> {
  values: (ValidArg | ValidArg[])[];
  readonly text: string;
  append: (sql: (SqlObjBase | false | undefined)[]) => SqlObj;
  readonly isEmpty: boolean;
}

interface WhereSqlObj extends SqlObjBase<SqlObjType.WHERE> {
  and(tempStrs: TemplateStringsArray, ...args: (ValidArg | SqlObjBase | undefined)[]): WhereSqlObj;
  or(tempStrs: TemplateStringsArray, ...args: (ValidArg | SqlObjBase | undefined)[]): WhereSqlObj;
  readonly isEmpty: boolean;
}

interface ValuesSqlObject extends SqlObjBase<SqlObjType.VALUES> {
  readonly isEmpty: boolean;
}

interface ColumnsSqlObject extends SqlObjBase<SqlObjType.COLUMNS> {
  readonly isEmpty: boolean;
  prefix(prefix: string): ColumnsSqlObject;
}

interface UpdateSqlObj extends SqlObjBase<SqlObjType.SET> {
  readonly isEmpty: boolean;
}

interface IdentifierSqlObj extends SqlObjBase<SqlObjType.IDENTIFIER> {}

interface UnnestSqlObj extends SqlObjBase<SqlObjType.UNNEST> {}

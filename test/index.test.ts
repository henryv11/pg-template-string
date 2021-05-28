import sql from '../src';

sql`UPDATE table ${sql.set({ hey: 24, there: 25 })} ${sql.where`ghb = ${12}`.and`ggg = ${12}`}`;

describe('set', () => {
  test('basics', () => {
    const query = sql`${'bljad'} ${sql.set({ hey: sql`hello there my little man ${45}`, hey2: 23 })}`;
    expect(query.text).toEqual(`$1 SET "hey" = hello there my little man $2, "hey2" = $3`);
    expect(query.values).toEqual(['bljad', 45, 23]);
  });

  test('undefined value', () => {
    const query = sql`${sql.set({ hello: undefined, hey: false, hey2: null })}`;
    expect(query.text).toEqual(`SET "hey" = $1, "hey2" = $2`);
    expect(query.values).toEqual([false, null]);
  });
});

describe('unnest', () => {
  test('performance', () => {
    const array = Array.from({ length: 200000 }, () => [1, 2, 3, 4]);
    const t0 = Date.now();
    const query = sql`${sql.unnest(['a', 'b', 'c', 'd'], array)}`;
    query.text;
    const t1 = Date.now();
    const duration = Number((t1 - t0).toFixed(4));
    expect(duration).toBeLessThan(50);
    expect(query.values.length).toEqual(4);
    query.values.forEach(value => expect((value as unknown[]).length).toEqual(200000));
  });

  test('basic stuff', () => {
    const query = sql`${sql.unnest(
      ['type', 'type', 'type'],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    )}`;
    expect(query.text).toEqual(`UNNEST($1::type, $2::type, $3::type)`);
    expect(query.values).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  test('basic stuff with a twist', () => {
    const query = sql`${'hello'} ${sql.unnest(
      ['type', 'type', 'type'],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    )}`;
    expect(query.text).toEqual(`$1 UNNEST($2::type, $3::type, $4::type)`);
    expect(query.values).toEqual(['hello', [1, 4], [2, 5], [3, 6]]);
  });
});

describe('where', () => {
  test('basic stuff', () => {
    const query = sql`${sql.where`${sql.identifier('hello')} = ${1212}`.and`b = d`.or`c = g`}`;
    expect(query.text).toEqual(`WHERE "hello" = $1 AND b = d OR c = g`);
    expect(query.values).toEqual([1212]);
  });
});

describe('columns', () => {
  test('prefix', () => {
    const query = sql`${sql
      .columns(['hello_there', sql.columns(['hey_hey', ['my_bad', 'myBad']]).prefix('prefix_inner')])
      .prefix('prefix_outer')}`;
    expect(query.text).toEqual(
      `"prefix_outer"."hello_there", "prefix_inner"."hey_hey", "prefix_inner"."my_bad" AS "myBad"`,
    );
    expect(query.values).toEqual([]);
  });

  test('with sql object', () => {
    const query = sql`${sql.columns(['hey', sql`COUNT(*) OVER AS ${sql.identifier('totalRows')}`]).prefix('prefix')}`;
    expect(query.text).toEqual(`"prefix"."hey", COUNT(*) OVER AS "totalRows"`);
    expect(query.values).toEqual([]);
  });
});

describe('basic queries', () => {
  test('select query with filtering columns and identifier', () => {
    const query = sql`SELECT ${sql.columns([
      ['hello_there', 'helloThere'],
      ['hey_hey', 'heyHey'],
      'hello',
    ])} FROM ${sql.identifier('table')} ${sql.where`bbb = ${12}`.and`fff = ${'hello'}`}`;
    expect(query.text).toEqual(
      `SELECT "hello_there" AS "helloThere", "hey_hey" AS "heyHey", "hello" FROM "table" WHERE bbb = $1 AND fff = $2`,
    );
    expect(query.values).toEqual([12, 'hello']);
  });

  test('batch insert query', () => {
    const query = sql`INSERT INTO table (col1, col2, col3) ${sql.values([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])}`;
    expect(query.text).toEqual(`INSERT INTO table (col1, col2, col3) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`);
    expect(query.values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('batch insert query with SELECT * FROM UNNEST ...', () => {
    const query = sql`INSERT INTO table (col1, col2, col3) SELECT * FROM ${sql.unnest(
      ['INTEGER[]', 'INTEGER[]', 'TEXT[]'],
      [
        [1, 2, 'hello'],
        [3, 4, 'there'],
        [5, 6, 'm8'],
      ],
    )}`;
    expect(query.text).toEqual(
      `INSERT INTO table (col1, col2, col3) SELECT * FROM UNNEST($1::INTEGER[], $2::INTEGER[], $3::TEXT[])`,
    );
    expect(query.values).toEqual([
      [1, 3, 5],
      [2, 4, 6],
      ['hello', 'there', 'm8'],
    ]);
  });

  test('update query with set', () => {
    const query = sql`UPDATE table ${sql.set({
      col1: 'value1',
      col2: 'value2',
      col3: 'value3',
      col4: 'value4',
      col5: undefined,
      hello_there: 12,
    })}`;
    expect(query.text).toEqual(`UPDATE table SET "col1" = $1, "col2" = $2, "col3" = $3, "col4" = $4`);
    expect(query.values).toEqual(['value1', 'value2', 'value3', 'value4']);
  });
});

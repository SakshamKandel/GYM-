import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { partnerOperationLockSql } from './partnerOperationLock.ts';

describe('partnerOperationLockSql', () => {
  it('uses one parameterized transaction-scoped advisory-lock namespace', () => {
    const query = new PgDialect().sqlToQuery(partnerOperationLockSql('partner-1'));

    assert.match(
      query.sql,
      /^select pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)$/,
    );
    assert.deepEqual(query.params, ['partner-1']);
  });
});

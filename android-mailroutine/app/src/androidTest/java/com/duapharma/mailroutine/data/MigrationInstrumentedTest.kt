package com.duapharma.mailroutine.data

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test

/**
 * Runs on a device/emulator (not in CI). Schemas are exported to app/schemas/ by the Room compiler;
 * commit each new schema JSON together with the Migration that targets it, then add a test per step.
 */
class MigrationInstrumentedTest {
    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), AppDatabase::class.java, emptyList(), FrameworkSQLiteOpenHelperFactory())

    @Test
    fun createsLatestSchemaAndValidatesIt() {
        helper.createDatabase("migration-test", AppDatabase.VERSION).close()
        helper.runMigrationsAndValidate("migration-test", AppDatabase.VERSION, true, *Migrations.ALL.toTypedArray()).close()
    }
}

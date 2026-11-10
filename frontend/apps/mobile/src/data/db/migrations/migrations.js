// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json'
import m0000 from './0000_init.sql'
import m0001 from './0001_illegal_zemo.sql'
import m0002 from './0002_silky_dorian_gray.sql'
import m0003 from './0003_premium_miek.sql'
import m0004 from './0004_lying_raider.sql'

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
  },
}

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig'

// 接続情報が未設定ならクラウド機能ごと無効（ローカルのみで動作）
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = cloudEnabled ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

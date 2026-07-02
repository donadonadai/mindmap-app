// Supabase 接続情報
// anon key は「公開してよい鍵」(データ保護は行単位セキュリティ RLS が担う)なので
// ここに直書きしてコミットして問題ない。
// 未設定(空文字)の間はクラウド機能が自動的に無効になり、ローカル保存のみで動く。
export const SUPABASE_URL = ''
export const SUPABASE_ANON_KEY = ''

<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\PricingRule;
use App\Models\Setting;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * 初期データ投入
     */
    public function run(): void
    {
        // 管理者ユーザー
        User::factory()->create([
            'name' => 'オーナー',
            'email' => 'admin@example.com',
            'password' => Hash::make('password'),
        ]);

        // 基本料金ルール（デフォルト・平日）
        PricingRule::create([
            'base_price' => 25000,
            'per_person_price' => 3000,
            'min_guests' => 1,
            'max_guests' => 10,
            'priority' => 0,
        ]);

        // 週末料金（金・土）
        PricingRule::create([
            'day_of_week' => 5, // 金曜
            'base_price' => 30000,
            'per_person_price' => 3500,
            'min_guests' => 1,
            'max_guests' => 10,
            'priority' => 10,
        ]);
        PricingRule::create([
            'day_of_week' => 6, // 土曜
            'base_price' => 35000,
            'per_person_price' => 4000,
            'min_guests' => 1,
            'max_guests' => 10,
            'priority' => 10,
        ]);

        // 施設設定
        $settings = [
            'facility_name' => 'the Terrace 長浜',
            'facility_address' => '広島県広島市', // 後で正式住所を設定
            'check_in_time' => '15:00',
            'check_out_time' => '10:00',
            'max_guests' => '10',
            'cancel_policy' => '7日前まで無料キャンセル。6日前〜当日は宿泊料金の100%',
            'owner_email' => 'admin@example.com',
        ];

        foreach ($settings as $key => $value) {
            Setting::setValue($key, $value);
        }
    }
}

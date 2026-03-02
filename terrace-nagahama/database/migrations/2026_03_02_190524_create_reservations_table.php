<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('reservations', function (Blueprint $table) {
            $table->id();
            $table->string('guest_name');           // 宿泊者名
            $table->string('guest_email');           // メールアドレス
            $table->string('guest_phone')->nullable(); // 電話番号
            $table->date('check_in');                // チェックイン日
            $table->date('check_out');               // チェックアウト日
            $table->unsignedTinyInteger('num_guests'); // 宿泊人数
            $table->boolean('has_bbq')->default(false); // BBQ利用
            $table->unsignedTinyInteger('num_cars')->default(0); // 駐車台数
            $table->unsignedInteger('total_price')->default(0);  // 合計金額（税込・円）
            $table->enum('status', ['pending', 'confirmed', 'cancelled', 'checked_in', 'completed'])
                  ->default('pending');              // ステータス
            $table->text('notes')->nullable();       // ゲスト備考
            $table->text('admin_notes')->nullable(); // 管理者メモ
            $table->timestamps();

            // 検索用インデックス
            $table->index('check_in');
            $table->index('check_out');
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('reservations');
    }
};

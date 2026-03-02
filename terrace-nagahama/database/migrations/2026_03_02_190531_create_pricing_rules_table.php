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
        Schema::create('pricing_rules', function (Blueprint $table) {
            $table->id();
            $table->date('date')->nullable();                    // 特定日（nullなら汎用ルール）
            $table->unsignedTinyInteger('day_of_week')->nullable(); // 曜日（0=日〜6=土）
            $table->unsignedInteger('base_price');               // 基本料金（1泊）
            $table->unsignedInteger('per_person_price')->default(0); // 人数加算（1人あたり）
            $table->unsignedTinyInteger('min_guests')->default(1);   // 最少人数
            $table->unsignedTinyInteger('max_guests')->default(10);  // 最大人数
            $table->unsignedSmallInteger('priority')->default(0);    // 優先度（高いほど優先）
            $table->timestamps();

            $table->index('date');
            $table->index('day_of_week');
            $table->index('priority');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('pricing_rules');
    }
};

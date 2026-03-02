<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PricingRule extends Model
{
    protected $fillable = [
        'date',
        'day_of_week',
        'base_price',
        'per_person_price',
        'min_guests',
        'max_guests',
        'priority',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'day_of_week' => 'integer',
            'base_price' => 'integer',
            'per_person_price' => 'integer',
            'min_guests' => 'integer',
            'max_guests' => 'integer',
            'priority' => 'integer',
        ];
    }
}

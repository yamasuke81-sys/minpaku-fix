<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Reservation extends Model
{
    protected $fillable = [
        'guest_name',
        'guest_email',
        'guest_phone',
        'check_in',
        'check_out',
        'num_guests',
        'has_bbq',
        'num_cars',
        'total_price',
        'status',
        'notes',
        'admin_notes',
    ];

    protected function casts(): array
    {
        return [
            'check_in' => 'date',
            'check_out' => 'date',
            'has_bbq' => 'boolean',
            'num_guests' => 'integer',
            'num_cars' => 'integer',
            'total_price' => 'integer',
        ];
    }

    /** 宿泊数を算出 */
    public function getNightsAttribute(): int
    {
        return $this->check_in->diffInDays($this->check_out);
    }
}

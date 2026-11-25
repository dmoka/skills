import pytest

from bank.account import InsufficientFunds, withdraw
from bank.fees import transfer_fee
from bank.memo import decode_memo, encode_memo
from bank.split import split


def test_withdraw_reduces_balance():
    assert withdraw(1000, 300) == 700


def test_withdraw_more_than_balance_fails():
    with pytest.raises(InsufficientFunds):
        withdraw(100, 500)


def test_fee_is_one_percent():
    assert transfer_fee(100_000) == 1000


def test_split_three_ways():
    assert split(100, 3) == [34, 33, 33]


def test_memo_roundtrip():
    assert decode_memo(encode_memo({"ref": "inv-1", "note": "a;b"})) == {"ref": "inv-1", "note": "a;b"}

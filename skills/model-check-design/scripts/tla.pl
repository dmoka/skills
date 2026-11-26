#!/usr/bin/env perl
# tla.pl — small TLA+/TLC-config reader shared by freeze.sh, anchors.sh and escape-hatches.sh.
# Usage: scripts/tla.pl <command> <file> [args]
#   defs <Spec.tla>                 one line per top-level definition: name<TAB>start<TAB>end
#   hash <Spec.tla> <Name>          SHA-256 of Name's definition plus every definition it uses
#   vars <Spec.tla>                 declared VARIABLES, one per line
#   actions <Spec.tla>              definitions that prime a variable or say UNCHANGED (minus Next/Spec)
#   next <Spec.tla>                 definitions Next refers to, one per line
#   sizes <Spec.tla>                name<TAB>size for definitions that are a literal set, a range or a number
#   checks <file.cfg>               INVARIANT / PROPERTY names, one per line
#   consts <file.cfg>               name<TAB>value for CONSTANT assignments
#   lines <file.cfg>                CONSTRAINT / ACTION_CONSTRAINT / CHECK_DEADLOCK / VIEW lines: line<TAB>text
# Reads a file path, or "-" for stdin. Comments are ignored everywhere.
use strict; use warnings;
use Digest::SHA qw(sha256_hex);

my ($cmd, $file, @args) = @ARGV;
die "usage: tla.pl <defs|hash|vars|actions|next|sizes|checks|consts|lines> <file> [args]\n" unless $cmd && defined $file;
my $text = do { local $/; if ($file eq '-') { <STDIN> } else { open my $fh, '<', $file or die "cannot read $file\n"; <$fh> } };
$text = '' unless defined $text;
my @lines = split /\n/, $text, -1;

sub strip_comments {   # keep line count: block comments become blank space
  my ($s) = @_;
  $s =~ s{\(\*.*?\*\)}{ my $m = $&; $m =~ s/[^\n]/ /g; $m }gse;
  $s =~ s/\\\*[^\n]*//g;
  return $s;
}
sub norm { my ($s) = @_; $s = strip_comments($s); $s =~ s/\s+/ /g; $s =~ s/^ | $//g; return $s; }

my $DEF = qr/^(?:LOCAL\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\)|\[[^\]]*\])?\s*==/;
my $STOP = qr/^(?:={4,}|-{4,}|(?:VARIABLES?|CONSTANTS?|EXTENDS|ASSUME|ASSUMPTION|THEOREM|INSTANCE)\b)/;

sub defs {   # name => [start, end, body] (1-based lines, body without the "Name ==" head)
  my @clean = split /\n/, strip_comments($text), -1;
  my (%d, $cur, $start);
  my $close = sub { my ($endl) = @_; return unless defined $cur;
    my $e = $endl; $e-- while $e > $start && $clean[$e - 1] =~ /^\s*$/;
    my $body = join "\n", @clean[$start - 1 .. $e - 1]; $body =~ s/^.*?==//s;
    $d{$cur} = [$start, $e, $body]; undef $cur; };
  for my $i (0 .. $#clean) {
    my $l = $clean[$i];
    if ($l =~ $DEF) { $close->($i); $cur = $1; $start = $i + 1; next; }
    if ($l =~ $STOP) { $close->($i); }
  }
  $close->(scalar @clean);
  return \%d;
}
sub idents { my ($s) = @_; my %s; $s{$_} = 1 for ($s =~ /\b([A-Za-z_][A-Za-z0-9_]*)\b/g); return keys %s; }

sub cfg_clean { return map { (my $x = $_) =~ s/\\\*.*$//; $x } @lines; }

if ($cmd eq 'defs') {
  my $d = defs(); printf "%s\t%d\t%d\n", $_, @{$d->{$_}}[0, 1] for sort { $d->{$a}[0] <=> $d->{$b}[0] } keys %$d;
} elsif ($cmd eq 'hash') {
  my $name = $args[0] or die "hash needs a definition name\n";
  my $d = defs(); die "no definition named $name\n" unless $d->{$name};
  my (%seen, @todo); @todo = ($name);
  while (my $n = shift @todo) { next if $seen{$n}++; push @todo, grep { $d->{$_} && !$seen{$_} } idents($d->{$n}[2]); }
  print sha256_hex(join '', map { "$_: " . norm($d->{$_}[2]) . "\n" } sort keys %seen), "\n";
} elsif ($cmd eq 'vars') {
  my $s = strip_comments($text);
  while ($s =~ /^VARIABLES?\b(.*?)(?=^\s*$|^\S.*==|^(?:={4,}|-{4,}|CONSTANTS?|ASSUME)\b|\z)/msg) {
    my $v = $1; $v =~ s/[\s,]+/ /g; print "$_\n" for grep { length } split / /, $v;
  }
} elsif ($cmd eq 'actions') {
  my $d = defs();
  for my $n (sort { $d->{$a}[0] <=> $d->{$b}[0] } keys %$d) {
    next if $n =~ /^(Next|Spec|Fairness|FairSpec|LiveSpec|vars)$/;
    my $b = $d->{$n}[2];
    print "$n\n" if ($b =~ /[A-Za-z0-9_\]\)]'/ || $b =~ /\bUNCHANGED\b/) && $b !~ /\[\]|<>|WF_|SF_/;
  }
} elsif ($cmd eq 'next') {
  my $d = defs(); die "no Next definition\n" unless $d->{Next};
  print "$_\n" for sort grep { $d->{$_} && $_ ne 'Next' } idents($d->{Next}[2]);
} elsif ($cmd eq 'sizes') {
  my $d = defs();
  for my $n (sort keys %$d) {
    my $b = norm($d->{$n}[2]);
    if ($b =~ /^\{(.*)\}$/ && $b !~ /[:|]/) { my $in = $1; my $k = ($in =~ /\S/) ? scalar(split /,/, $in) : 0; print "$n\t$k\n"; }
    elsif ($b =~ /^(\d+)\s*\.\.\s*(\d+)$/) { print "$n\t", ($2 >= $1 ? $2 - $1 + 1 : 0), "\n"; }
    elsif ($b =~ /^(\d+)$/) { print "$n\t$1\n"; }
  }
} elsif ($cmd eq 'checks') {
  my $on = 0;
  for (cfg_clean()) {
    if (/^\s*(INVARIANTS?|PROPERTY|PROPERTIES)\b(.*)$/) { $on = 1; $_ = $2; }
    elsif (/^\s*[A-Z_]{4,}\b/) { $on = 0; }
    print "$_\n" for $on ? grep { length } split /\s+/ : ();
  }
} elsif ($cmd eq 'consts') {
  my $on = 0;
  for (cfg_clean()) {
    if (/^\s*CONSTANTS?\b(.*)$/) { $on = 1; $_ = $1; }
    elsif (/^\s*[A-Z_]{4,}\b/) { $on = 0; }
    next unless $on;
    while (/([A-Za-z_][A-Za-z0-9_]*)\s*(=|<-)\s*(\{[^}]*\}|\S+)/g) { print "$1\t$3\n"; }
  }
} elsif ($cmd eq 'lines') {
  my $i = 0;
  for (cfg_clean()) { $i++; print "$i\t$_\n" if /^\s*(ACTION_CONSTRAINTS?|CONSTRAINTS?|CHECK_DEADLOCK|VIEW)\b/; }
} else { die "unknown command: $cmd\n"; }

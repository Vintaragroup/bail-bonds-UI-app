import React, { useState } from 'react';
import { ArrowLeft, CreditCard, DollarSign, Shield, AlertCircle, Check, Calculator, Users, FileText } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { useCreatePayment } from '../../hooks/payments';
import { useToast } from '../ToastContext';

export function PaymentForm({ onNavigate }) {
  const [paymentType, setPaymentType] = useState('bond');
  const [paymentMethod, setPaymentMethod] = useState('credit-card');
  const [amount, setAmount] = useState('');
  const [clientName, setClientName] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const createPayment = useCreatePayment();
  const { pushToast } = useToast();

  const calculateFees = (baseAmount) => {
    const processingFee = baseAmount * 0.029; // 2.9% processing fee
    const serviceFee = 2.50; // Flat service fee
    return { processingFee, serviceFee, total: baseAmount + processingFee + serviceFee };
  };

  const numericAmount = parseFloat(amount) || 0;
  const fees = amount ? calculateFees(parseFloat(amount) || 0) : { processingFee: 0, serviceFee: 0, total: 0 };

  const paymentMethods = [
    {
      id: 'card-1',
      type: 'credit-card',
      display: 'Visa •••• 4242',
      fee: '2.9%'
    },
    {
      id: 'bank-1',
      type: 'bank-account',
      display: 'First National •••• 7890',
      fee: '0.8%'
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start space-x-6">
            <PillButton 
              variant="ghost"
              size="sm"
              onClick={() => onNavigate('billing-dashboard')}
              className="mt-1"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Billing
            </PillButton>
            <div>
              <h1 className="text-3xl text-foreground mb-2">Process Payment</h1>
              <p className="text-muted-foreground">
                Collect bond payments and fees from clients
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Payment Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Payment Type */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <FileText className="h-5 w-5 mr-2" />
                  Payment Details
                </CardTitle>
                <CardDescription>
                  Select the type of payment and enter client information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label className="text-sm">Payment Type</Label>
                  <RadioGroup value={paymentType} onValueChange={setPaymentType} className="mt-3">
                    <div className="flex items-center space-x-3 py-2">
                      <RadioGroupItem value="bond" id="bond" />
                      <Label htmlFor="bond">Bond Payment</Label>
                    </div>
                    <div className="flex items-center space-x-3 py-2">
                      <RadioGroupItem value="partial" id="partial" />
                      <Label htmlFor="partial">Partial Payment</Label>
                    </div>
                    <div className="flex items-center space-x-3 py-2">
                      <RadioGroupItem value="fee" id="fee" />
                      <Label htmlFor="fee">Service Fee</Label>
                    </div>
                    <div className="flex items-center space-x-3 py-2">
                      <RadioGroupItem value="premium" id="premium" />
                      <Label htmlFor="premium">Premium Payment</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="client-name" className="text-sm">Client Name *</Label>
                    <Input 
                      id="client-name"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Enter client's full name"
                      className="mt-2 h-10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="case-number" className="text-sm">Case Number</Label>
                    <Input 
                      id="case-number"
                      value={caseNumber}
                      onChange={(e) => setCaseNumber(e.target.value)}
                      placeholder="BB-2024-001"
                      className="mt-2 h-10"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="amount" className="text-sm">Payment Amount *</Label>
                  <div className="relative mt-2">
                    <DollarSign className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input 
                      id="amount"
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-10 h-10"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes" className="text-sm">Payment Notes</Label>
                  <Textarea 
                    id="notes"
                    placeholder="Additional notes about this payment..."
                    rows={3}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Payment Method */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <CreditCard className="h-5 w-5 mr-2" />
                  Payment Method
                </CardTitle>
                <CardDescription>
                  Choose how the client will pay
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                  {paymentMethods.map((method) => (
                    <div key={method.id} className="flex items-center space-x-3 p-4 border rounded-lg">
                      <RadioGroupItem value={method.id} id={method.id} />
                      <Label htmlFor={method.id} className="flex-1 cursor-pointer">
                        <div className="flex items-center justify-between">
                          <span>{method.display}</span>
                          <Badge variant="secondary" className="text-xs px-2 py-1 ml-8">
                            {method.fee} fee
                          </Badge>
                        </div>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>

                <div className="pt-4 border-t">
                  <PillButton variant="outline" size="sm">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Add New Payment Method
                  </PillButton>
                </div>
              </CardContent>
            </Card>

            {/* Terms and Security */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Shield className="h-5 w-5 mr-2" />
                  Security & Terms
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="border-blue-200 bg-blue-50">
                  <Shield className="h-4 w-4 text-primary" />
                  <AlertDescription>
                    This payment will be processed securely using 256-bit SSL encryption. 
                    Your payment information is protected and PCI DSS compliant.
                  </AlertDescription>
                </Alert>

                <div className="flex items-start space-x-2">
                  <Checkbox 
                    id="terms" 
                    checked={acceptTerms}
                    onCheckedChange={setAcceptTerms}
                  />
                  <Label htmlFor="terms" className="text-sm leading-relaxed">
                    I acknowledge that this payment is for bail bond services and understand the 
                    terms and conditions. I confirm the payment amount and client information is correct.
                  </Label>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Payment Summary */}
          <div>
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Calculator className="h-5 w-5 mr-2" />
                  Payment Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Payment Type:</span>
                    <span className="capitalize">{paymentType} Payment</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Client:</span>
                    <span>{clientName || 'Not specified'}</span>
                  </div>
                  {caseNumber && (
                    <div className="flex justify-between text-sm">
                      <span>Case:</span>
                      <span>{caseNumber}</span>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Payment Amount:</span>
                    <span>${amount || '0.00'}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Processing Fee:</span>
                    <span>${fees.processingFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Service Fee:</span>
                    <span>${fees.serviceFee.toFixed(2)}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between">
                  <span>Total Amount:</span>
                  <span>${fees.total.toFixed(2)}</span>
                </div>

                <PillButton
                  className="w-full mt-6"
                  disabled={!amount || !clientName || !acceptTerms || createPayment.isLoading}
                  onClick={async () => {
                    try {
                      await createPayment.mutateAsync({
                        amount: numericAmount,
                        currency: 'usd',
                        method: paymentMethod.includes('bank') ? 'ach_debit' : 'card',
                        clientName,
                        metadata: {
                          caseNumber,
                          paymentType,
                        },
                      });
                      pushToast({ variant: 'success', title: 'Payment submitted', message: 'Payment queued for processing.' });
                      onNavigate('payment-confirmation');
                    } catch (err) {
                      pushToast({
                        variant: 'error',
                        title: 'Unable to process payment',
                        message: err instanceof Error ? err.message : 'Unexpected error',
                      });
                    }
                  }}
                >
                  <Check className="h-4 w-4 mr-2" />
                  {createPayment.isLoading ? 'Processing…' : 'Process Payment'}
                </PillButton>

                <p className="text-xs text-muted-foreground text-center">
                  Payment will be processed immediately
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
